(function () {
  'use strict';

  // Config is set inline by snippets/easy-wish.liquid before this file loads
  var EW = window.EasyWishConfig;
  if (!EW) return;

  /* ================================================================
     STORAGE
     Persists an array of product objects in localStorage.
     Each item's unique key is the product handle.
  ================================================================ */
  var STORAGE_KEY = 'easywish_v1';

  var EasyWishStorage = {
    _items: null,

    _load: function () {
      if (this._items) return;
      try {
        this._items = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      } catch (e) {
        this._items = [];
      }
    },

    _save: function () {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this._items)); } catch (e) {}
    },

    _notify: function () {
      window.dispatchEvent(new CustomEvent('easywish:change', { detail: { items: this._items } }));
    },

    getAll: function () { this._load(); return this._items.slice(); },

    has: function (key) {
      this._load();
      return this._items.some(function (p) { return p.key === key; });
    },

    add: function (product) {
      this._load();
      if (this.has(product.key)) return false;
      product.addedAt = Date.now();
      this._items.unshift(product);
      this._save();
      this._notify();
      return true;
    },

    remove: function (key) {
      this._load();
      var before = this._items.length;
      this._items = this._items.filter(function (p) { return p.key !== key; });
      if (this._items.length === before) return false;
      this._save();
      this._notify();
      return true;
    },

    toggle: function (product) {
      return this.has(product.key) ? this.remove(product.key) : this.add(product);
    },

    count: function () { this._load(); return this._items.length; },
  };

  /* ================================================================
     HELPERS
  ================================================================ */
  function heartSVG() {
    return '<svg class="ew-heart-icon" viewBox="0 0 24 24" aria-hidden="true">'
      + '<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>'
      + '</svg>';
  }

  /* ================================================================
     WEB COMPONENT: <easy-wish-button>
     Attributes:
       product-key          — unique key (handle preferred)
       product-id           — numeric Shopify product ID
       product-handle       — product handle
       product-title        — product title
       product-image        — featured image URL
       product-price        — price in cents
       product-compare-price — compare-at price in cents
       product-url          — /products/handle
       variant-id           — default variant ID
       variant-title        — default variant title
       pdp                  — "true" for PDP full-width style
  ================================================================ */
  class EasyWishButton extends HTMLElement {
    connectedCallback() {
      this._key = this.getAttribute('product-key')
        || this.getAttribute('product-handle')
        || this.getAttribute('product-id');
      this._render();
      this._btn = this.querySelector('.ew-btn');
      this._update();
      this._btn.addEventListener('click', this._toggle.bind(this));
      window.addEventListener('easywish:change', this._update.bind(this));
    }

    disconnectedCallback() {
      window.removeEventListener('easywish:change', this._update.bind(this));
    }

    _render() {
      var isPdp = this.getAttribute('pdp') === 'true';
      var label = EasyWishStorage.has(this._key) ? 'Remove from wishlist' : 'Add to wishlist';
      this.innerHTML = '<button class="ew-btn" type="button" aria-label="' + label + '">'
        + heartSVG()
        + (isPdp ? '<span class="ew-pdp-btn-label">' + label + '</span>' : '')
        + '</button>';
      if (isPdp) this.classList.add('ew-pdp-btn');
    }

    _update() {
      var active = EasyWishStorage.has(this._key);
      this.classList.toggle('ew-active', active);
      var label = active ? 'Remove from wishlist' : 'Add to wishlist';
      if (this._btn) this._btn.setAttribute('aria-label', label);
      var span = this.querySelector('.ew-pdp-btn-label');
      if (span) span.textContent = label;
    }

    _toggle(e) {
      e.preventDefault();
      e.stopPropagation();
      EasyWishStorage.toggle(this._productData());
      this._update();
    }

    _productData() {
      return {
        key:          this._key,
        id:           this.getAttribute('product-id') || '',
        handle:       this.getAttribute('product-handle') || '',
        title:        this.getAttribute('product-title') || '',
        image:        this.getAttribute('product-image') || '',
        price:        parseInt(this.getAttribute('product-price') || '0', 10),
        comparePrice: parseInt(this.getAttribute('product-compare-price') || '0', 10) || 0,
        url:          this.getAttribute('product-url') || '',
        variantId:    this.getAttribute('variant-id') || '',
        variantTitle: this.getAttribute('variant-title') || '',
      };
    }
  }

  /* ================================================================
     WEB COMPONENT: <easy-wish-count>
     Renders a badge with the current wishlist count.
  ================================================================ */
  class EasyWishCount extends HTMLElement {
    connectedCallback() {
      this._update();
      window.addEventListener('easywish:change', this._update.bind(this));
    }
    disconnectedCallback() {
      window.removeEventListener('easywish:change', this._update.bind(this));
    }
    _update() {
      var n = EasyWishStorage.count();
      this.innerHTML = n > 0
        ? '<span class="ew-count-badge" aria-label="' + n + ' items in wishlist">' + n + '</span>'
        : '';
    }
  }

  /* ================================================================
     WEB COMPONENT: <easy-wish-trigger>
     Header heart icon button that opens the drawer.
  ================================================================ */
  class EasyWishTrigger extends HTMLElement {
    connectedCallback() {
      this.innerHTML = '<button class="ew-trigger-btn" type="button" aria-label="Open wishlist" aria-haspopup="dialog">'
        + heartSVG()
        + '<easy-wish-count></easy-wish-count>'
        + '</button>';
      this.querySelector('.ew-trigger-btn').addEventListener('click', function () {
        window.dispatchEvent(new CustomEvent('easywish:open'));
      });
    }
  }

  /* ================================================================
     WEB COMPONENT: <easy-wish-drawer>
     Slide-out panel. Shell HTML is Liquid-rendered by the snippet.
     Product item cards are fetched via Section Rendering API
     (/products/{handle}?sections=easy-wish) — all formatting,
     images, prices, and translations come from Shopify Liquid.
  ================================================================ */
  class EasyWishDrawer extends HTMLElement {
    connectedCallback() {
      // HTML is already server-rendered — just cache the list and wire events
      this._list = this.querySelector('.ew-items-list');
      this._shareBtn = this.querySelector('.ew-share-btn');
      this.querySelector('.ew-overlay').addEventListener('click', this._close.bind(this));
      this.querySelector('.ew-close-btn').addEventListener('click', this._close.bind(this));
      if (this._shareBtn) this._shareBtn.addEventListener('click', this._share.bind(this));
      window.addEventListener('easywish:open',   this._open.bind(this));
      window.addEventListener('easywish:change', this._onchange.bind(this));
      document.addEventListener('keydown',       this._onkey.bind(this));
      // One delegated listener covers all item interactions regardless of re-renders
      this._delegateListEvents();
      this._updateShareBtn();
    }

    disconnectedCallback() {
      window.removeEventListener('easywish:open',   this._open.bind(this));
      window.removeEventListener('easywish:change', this._onchange.bind(this));
      document.removeEventListener('keydown',       this._onkey.bind(this));
    }

    _delegateListEvents() {
      var self = this;
      this._list.addEventListener('click', function (e) {
        var rem = e.target.closest('.ew-remove-item-btn');
        if (rem) { EasyWishStorage.remove(rem.dataset.key); return; }
        var atc = e.target.closest('.ew-atc-btn[data-variant-id]');
        if (atc && !atc.disabled) self._addToCart(atc.dataset.variantId, atc);
      });
    }

    _open() {
      this.classList.add('ew-open');
      document.body.classList.add('ew-locked');
      this._renderItems();
      this._updateShareBtn();
      var closeBtn = this.querySelector('.ew-close-btn');
      if (closeBtn) setTimeout(function () { closeBtn.focus(); }, 50);
    }

    _close() {
      this.classList.remove('ew-open');
      document.body.classList.remove('ew-locked');
    }

    _onkey(e) {
      if (e.key === 'Escape' && this.classList.contains('ew-open')) this._close();
    }

    _updateShareBtn() {
      if (!this._shareBtn) return;
      var hasItems = EasyWishStorage.count() > 0;
      this._shareBtn.style.display = hasItems ? '' : 'none';
    }

    _share() {
      var items = EasyWishStorage.getAll();
      if (!items.length) return;
      var handles = items.map(function (p) { return p.handle || p.key; }).filter(Boolean);
      var url = window.location.origin + '/?easywish=' + handles.join(',');

      var self = this;
      if (navigator.share) {
        navigator.share({ title: 'My Wishlist', url: url }).catch(function () {});
      } else if (navigator.clipboard) {
        navigator.clipboard.writeText(url).then(function () { self._shareFeedback(); }).catch(function () {
          self._shareFallbackCopy(url);
        });
      } else {
        self._shareFallbackCopy(url);
      }
    }

    _shareFallbackCopy(url) {
      var input = document.createElement('input');
      input.style.cssText = 'position:fixed;top:-9999px;opacity:0';
      input.value = url;
      document.body.appendChild(input);
      input.select();
      try { document.execCommand('copy'); this._shareFeedback(); } catch (e) {}
      document.body.removeChild(input);
    }

    _shareFeedback() {
      if (!this._shareBtn) return;
      var label = this._shareBtn.querySelector('.ew-share-label');
      if (label) {
        var orig = label.textContent;
        label.textContent = 'Copied!';
        this._shareBtn.classList.add('ew-share-copied');
        setTimeout(function () {
          label.textContent = orig;
          this._shareBtn && this._shareBtn.classList.remove('ew-share-copied');
        }.bind(this), 2000);
      }
    }

    // Smart diff: removes deleted items instantly; fetches API only for new ones
    _onchange() {
      if (!this.classList.contains('ew-open')) return;
      this._updateShareBtn();

      var current    = EasyWishStorage.getAll();
      var currentKeys = new Set(current.map(function (p) { return p.handle || p.key; }));

      // Drop removed items without touching the network
      this._list.querySelectorAll('.ew-item[data-key]').forEach(function (el) {
        if (!currentKeys.has(el.dataset.key)) el.remove();
      });

      // Check for newly added items that have no rendered node yet
      var renderedKeys = new Set(
        Array.from(this._list.querySelectorAll('.ew-item[data-key]'))
          .map(function (el) { return el.dataset.key; })
      );
      var needsFetch = current.some(function (p) { return !renderedKeys.has(p.handle || p.key); });

      if (needsFetch) {
        this._renderItems(); // in-memory cache makes re-fetches cheap
      } else if (!this._list.querySelector('.ew-item')) {
        this._list.innerHTML = EasyWishDrawer._emptyHTML();
      }
    }

    // Fetch all item cards in parallel from sections/easy-wish.liquid
    async _renderItems() {
      var items = EasyWishStorage.getAll();
      if (!this._list) return;

      if (items.length === 0) {
        this._list.innerHTML = EasyWishDrawer._emptyHTML();
        return;
      }

      this._list.innerHTML = '<div class="ew-loading"><div class="ew-spinner"></div>Loading&hellip;</div>';

      var self  = this;
      var nodes = await Promise.all(
        items.map(function (p) { return self._fetchItem(p.handle || p.key); })
      );

      this._list.innerHTML = '';
      nodes.forEach(function (node) { if (node) self._list.appendChild(node); });

      if (!this._list.querySelector('.ew-item')) {
        this._list.innerHTML = EasyWishDrawer._emptyHTML();
      }
    }

    // Fetch one product card via Section Rendering API, cache the parsed node
    async _fetchItem(handle) {
      if (!handle) return null;
      var cache = EasyWishDrawer._cache;
      if (cache[handle]) return cache[handle].cloneNode(true);

      try {
        var res = await fetch(
          '/products/' + encodeURIComponent(handle) + '?sections=easy-wish'
        );
        if (!res.ok) return null;

        var data = await res.json();
        if (!data['easy-wish']) return null;

        // DOMParser is safe — <script> tags in section responses never execute
        var doc  = new DOMParser().parseFromString(data['easy-wish'], 'text/html');
        var node = doc.querySelector('.ew-item');
        if (node) { cache[handle] = node; return node.cloneNode(true); }
      } catch (e) {}
      return null;
    }

    static _emptyHTML() {
      return '<div class="ew-empty-state">'
        + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">'
        +   '<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>'
        + '</svg>'
        + '<p>Your wishlist is empty.</p></div>';
    }

    async _addToCart(variantId, btn) {
      var orig = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Adding\u2026';
      try {
        var res = await fetch('/cart/add.js', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body:    JSON.stringify({ id: Number(variantId), quantity: 1 }),
        });
        if (res.ok) {
          btn.textContent = 'Added!';
          btn.classList.add('ew-atc-success');
          document.dispatchEvent(new CustomEvent('cart:refresh'));
          fetch('/cart.js').then(function (r) { return r.json(); }).then(function (cart) {
            document.dispatchEvent(new CustomEvent('cart:updated', { detail: cart, bubbles: true }));
            var bubble = document.querySelector(
              '.cart-count-bubble, .site-header__cart-bubble, #cart-icon-bubble .cart-count-bubble'
            );
            if (bubble) {
              var span = bubble.querySelector('span:not([aria-hidden])') || bubble;
              if (span) span.textContent = cart.item_count;
            }
          });
        } else {
          btn.textContent = 'Error';
        }
      } catch (e) {
        btn.textContent = 'Error';
      }
      setTimeout(function () {
        btn.textContent = orig;
        btn.disabled = false;
        btn.classList.remove('ew-atc-success');
      }, 2500);
    }
  }

  // In-memory cache shared across all drawer instances
  EasyWishDrawer._cache = {};

  /* ================================================================
     REGISTER CUSTOM ELEMENTS
  ================================================================ */
  if (!customElements.get('easy-wish-button'))  customElements.define('easy-wish-button',  EasyWishButton);
  if (!customElements.get('easy-wish-count'))   customElements.define('easy-wish-count',   EasyWishCount);
  if (!customElements.get('easy-wish-trigger')) customElements.define('easy-wish-trigger', EasyWishTrigger);
  if (!customElements.get('easy-wish-drawer'))  customElements.define('easy-wish-drawer',  EasyWishDrawer);

  /* ================================================================
     AUTO-INJECTION
     Injects wishlist buttons into the header, product cards, and PDP.
     Runs on DOMContentLoaded + Shopify section:load events + MutationObserver.
  ================================================================ */

  function injectHeader() {
    if (!EW.headerEnabled) return;
    if (document.querySelector('easy-wish-trigger')) return;

    var selectors = [
      '.header__icons',                 // Dawn
      '.site-header__icons',            // Debut
      '.header-wrapper .header__icons',
      'header .nav-bar__icons',         // Brooklyn
      '.site-nav--icons',
      '.header__actions',
    ];

    var container = null;
    for (var i = 0; i < selectors.length; i++) {
      container = document.querySelector(selectors[i]);
      if (container) break;
    }
    if (!container) return;

    var trigger = document.createElement('easy-wish-trigger');
    var pos = EW.headerPosition;

    if (pos === 'before_cart') {
      var cartEl = container.querySelector('[href*="/cart"], #cart-icon-bubble, .header__icon--cart');
      container.insertBefore(trigger, cartEl ? (cartEl.closest('a') || cartEl) : container.firstChild);

    } else if (pos === 'after_cart') {
      var cartEl2 = container.querySelector('[href*="/cart"], #cart-icon-bubble, .header__icon--cart');
      var ref = cartEl2
        ? (cartEl2.parentNode === container ? cartEl2.nextSibling : cartEl2.closest('a')?.nextSibling)
        : null;
      container.insertBefore(trigger, ref || null);

    } else if (pos === 'before_account') {
      var accEl = container.querySelector('[href*="/account"], .header__icon--account');
      container.insertBefore(trigger, accEl ? (accEl.closest('a') || accEl) : container.firstChild);

    } else {
      container.insertBefore(trigger, container.firstChild);
    }
  }

  function injectCards() {
    if (!EW.cardEnabled) return;

    var cardSelectors = [
      '[data-product-card]',  // Dawn
      '.product-card',
      '.card-wrapper',
      '.product-item',
      '.grid-product',
      '[data-product-id]',
    ];

    document.querySelectorAll(cardSelectors.join(',')).forEach(function (card) {
      if (card.querySelector('easy-wish-button')) return;

      var productId = card.dataset.productCard || card.dataset.productId || '';

      var link   = card.querySelector('a[href*="/products/"]');
      var handle = '';
      if (link) {
        var m = link.getAttribute('href').match(/\/products\/([^/?#]+)/);
        handle = m ? m[1] : '';
      }
      handle = handle || card.dataset.productHandle || '';

      var key = handle || productId;
      if (!key) return;

      var titleEl = card.querySelector(
        '.card__heading a, .card__heading, .product-card__title, .grid-product__title, h2 a, h3 a, h4 a'
      );
      var imgEl = card.querySelector('img');
      var image = imgEl
        ? (imgEl.src || imgEl.dataset.src || imgEl.getAttribute('srcset')?.split(' ')?.[0] || '').split('?')[0]
        : '';

      var btn = document.createElement('easy-wish-button');
      btn.setAttribute('product-key',    key);
      btn.setAttribute('product-id',     productId);
      btn.setAttribute('product-handle', handle);
      btn.setAttribute('product-title',  titleEl ? titleEl.textContent.trim() : '');
      btn.setAttribute('product-image',  image);
      btn.setAttribute('product-url',    link ? link.getAttribute('href') : (handle ? '/products/' + handle : ''));
      btn.classList.add('ew-card-' + EW.cardPosition);

      if (window.getComputedStyle(card).position === 'static') card.style.position = 'relative';
      card.appendChild(btn);
    });
  }

  function injectPDP() {
    if (!EW.pdpEnabled) return;
    if (document.querySelector('.ew-pdp-injected')) return;

    // Resolve product data — try multiple sources for 1.0 + 2.0 compatibility
    var productData = null;

    if (window.ShopifyAnalytics?.meta?.product) {
      productData = window.ShopifyAnalytics.meta.product;
    }
    if (!productData) {
      var jsonScript = document.querySelector('script[id^="ProductJSON-"]');
      if (jsonScript) {
        try { productData = JSON.parse(jsonScript.textContent); } catch (e) {}
      }
    }
    if (!productData && window.__st?.p) {
      productData = window.__st.p;
    }

    var btnSelectors = [
      '.product-form__buttons',         // Dawn
      '.product-form__submit',
      '.product-single__add-to-cart',   // Debut
      '[data-add-to-cart]',
      'form[action*="/cart/add"] .btn',
    ];

    var target = null;
    for (var j = 0; j < btnSelectors.length; j++) {
      target = document.querySelector(btnSelectors[j]);
      if (target) break;
    }
    if (!target) return;

    var btn = document.createElement('easy-wish-button');
    btn.setAttribute('pdp', 'true');
    btn.classList.add('ew-pdp-injected');

    if (productData) {
      var handle  = productData.handle || '';
      var id      = String(productData.id || '');
      var variant = productData.variants?.[0] || {};
      var featImg = productData.featured_image || productData.images?.[0] || '';
      if (featImg && typeof featImg === 'object') featImg = featImg.src || '';

      btn.setAttribute('product-key',           handle || id);
      btn.setAttribute('product-id',            id);
      btn.setAttribute('product-handle',        handle);
      btn.setAttribute('product-title',         productData.title || '');
      btn.setAttribute('product-url',           handle ? '/products/' + handle : '');
      btn.setAttribute('variant-id',            String(variant.id || ''));
      btn.setAttribute('variant-title',         variant.title || '');
      btn.setAttribute('product-price',         String(variant.price || 0));
      btn.setAttribute('product-compare-price', String(variant.compare_at_price || 0));
      btn.setAttribute('product-image',         String(featImg).split('?')[0]);
    } else {
      var form = document.querySelector('form[action*="/cart/add"]');
      var vid  = form?.querySelector('[name="id"]');
      if (vid) btn.setAttribute('variant-id', vid.value);
    }

    if (EW.pdpPosition === 'before') {
      target.parentNode.insertBefore(btn, target);
    } else {
      target.parentNode.insertBefore(btn, target.nextSibling);
    }
  }

  /* ================================================================
     SHARED WISHLIST IMPORT
     On page load, check for ?easywish=handle1,handle2 in the URL.
     Fetches each product via /products/{handle}.js, adds to storage,
     then opens the drawer. Cleans the param from the URL afterward.
  ================================================================ */
  async function importSharedWishlist() {
    var params = new URLSearchParams(window.location.search);
    var shared = params.get('easywish');
    if (!shared) return;

    // Remove the param from the URL before doing anything else
    params.delete('easywish');
    var newSearch = params.toString();
    history.replaceState(null, '',
      window.location.pathname + (newSearch ? '?' + newSearch : '') + window.location.hash
    );

    var handles = shared.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    if (!handles.length) return;

    await Promise.all(handles.map(async function (handle) {
      if (EasyWishStorage.has(handle)) return;
      try {
        var res = await fetch('/products/' + encodeURIComponent(handle) + '.js');
        if (!res.ok) return;
        var p = await res.json();
        var variant = (p.variants && p.variants[0]) || {};
        var featImg = p.featured_image || '';
        if (featImg && typeof featImg === 'object') featImg = featImg.src || '';
        EasyWishStorage.add({
          key:          p.handle || String(p.id),
          id:           String(p.id),
          handle:       p.handle || '',
          title:        p.title || '',
          image:        String(featImg).split('?')[0],
          price:        variant.price || 0,
          comparePrice: variant.compare_at_price || 0,
          url:          '/products/' + p.handle,
          variantId:    String(variant.id || ''),
          variantTitle: variant.title || '',
        });
      } catch (e) {}
    }));

    window.dispatchEvent(new CustomEvent('easywish:open'));
  }

  function init() {
    injectHeader();
    injectCards();
    injectPDP();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { init(); importSharedWishlist(); });
  } else {
    init();
    importSharedWishlist();
  }

  // Re-inject after Shopify OS 2.0 section editor changes
  document.addEventListener('shopify:section:load', function () {
    setTimeout(init, 100);
  });

  // Re-inject on dynamically added cards (infinite scroll, quick-view, etc.)
  var _injectTimer;
  new MutationObserver(function (mutations) {
    var relevant = mutations.some(function (m) {
      return Array.from(m.addedNodes).some(function (n) {
        return n.nodeType === 1 && (
          n.matches('[data-product-card],[data-product-id],.product-card,.card-wrapper')
          || n.querySelector('[data-product-card],[data-product-id],.product-card,.card-wrapper')
        );
      });
    });
    if (relevant) {
      clearTimeout(_injectTimer);
      _injectTimer = setTimeout(injectCards, 150);
    }
  }).observe(document.body, { childList: true, subtree: true });

})();