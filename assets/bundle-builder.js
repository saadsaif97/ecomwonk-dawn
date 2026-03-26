/* ============================================================
   Bundle Builder — bundle-builder.js
   ============================================================ */

class BundleBuilder {
  constructor() {
    this.state = {
      deals:        [],   // parsed from DOM
      activeDeal:   null, // { qty, collection, originalPrice, finalPrice, title, savedPct, el }
      slots:        [],   // array of slot objects | null  (length = activeDeal.qty)
      products:     [],
      activeFilter: 'all'
    };
    this.cache = {};

    this._initDeals();
    this._bindUI();
  }

  /* ── Init ─────────────────────────────────────────────── */

  _initDeals() {
    const buttons = [...document.querySelectorAll('.bb-deal-btn')];
    this.state.deals = buttons.map(btn => ({
      el:            btn,
      qty:           parseInt(btn.dataset.quantity)      || 0,
      collection:    btn.dataset.collection,
      originalPrice: parseFloat(btn.dataset.originalPrice) || 0,
      finalPrice:    parseFloat(btn.dataset.finalPrice)    || 0,
      title:         btn.dataset.title,
      savedPct:      parseInt(btn.dataset.savedPct)      || 0
    }));

    if (!this.state.deals.length) return;

    // Auto-select the last deal (best value) by default
    this._selectDeal(this.state.deals[this.state.deals.length - 1]);

    // Always show the mobile footer
    document.getElementById('bb-mobile-footer')?.classList.add('bb-mobile-footer--visible');
  }

  /* ── Deal Selection ───────────────────────────────────── */

  _selectDeal(deal) {
    const prev = this.state.activeDeal;
    this.state.activeDeal = deal;

    // Preserve filled slots when shrinking, expand with nulls when growing
    const prevSlots = this.state.slots;
    this.state.slots = Array.from({ length: deal.qty }, (_, i) => prevSlots[i] || null);

    // Update headline
    const titleEl   = document.getElementById('bb-deal-title');
    const perUnitEl = document.getElementById('bb-deal-per-unit');
    if (titleEl)   titleEl.textContent   = `${deal.qty} pack for $${deal.finalPrice.toFixed(2)}`;
    if (perUnitEl) perUnitEl.textContent = deal.qty > 0 ? `$${(deal.finalPrice / deal.qty).toFixed(2)} / shirt` : '';

    // Highlight active button
    document.querySelectorAll('.bb-deal-btn').forEach(b =>
      b.classList.toggle('bb-deal-btn--active', b === deal.el)
    );

    // Fetch products (only if collection changed or first load)
    if (!prev || prev.collection !== deal.collection) {
      this._fetchProducts(deal.collection);
    } else {
      this._renderGrid();
    }

    this._renderSlots();
    this._refreshBuyBtns();
  }

  /* ── Products ─────────────────────────────────────────── */

  async _fetchProducts(handle) {
    const list = document.getElementById('bb-product-list');
    if (!handle) return;

    if (this.cache[handle]) {
      this._onLoaded(this.cache[handle]);
      return;
    }

    list.innerHTML = '<div class="bb-loading"><div class="bb-spinner"></div></div>';

    try {
      const res  = await fetch(`/collections/${handle}/products.json?limit=50`);
      const data = await res.json();
      this.cache[handle] = data.products || [];
      this._onLoaded(this.cache[handle]);
    } catch {
      list.innerHTML = '<p class="bb-error">Could not load products. Please refresh the page.</p>';
    }
  }

  _onLoaded(products) {
    this.state.products = products;
    this.state.activeFilter = 'all';
    this._renderFilters();
    this._renderGrid();
  }

  /* ── Filter Tabs ──────────────────────────────────────── */

  _renderFilters() {
    const nav = document.getElementById('bb-filter-tabs');
    if (!nav) return;

    const types = ['all', ...new Set(
      this.state.products.map(p => p.product_type).filter(Boolean)
    )];

    // Only render tabs if there are multiple types
    if (types.length <= 2) {
      nav.innerHTML = '';
      return;
    }

    nav.innerHTML = types.map(t => `
      <button
        class="bb-filter-tab ${this.state.activeFilter === t ? 'bb-filter-tab--active' : ''}"
        data-filter="${this._esc(t)}"
      >${t === 'all' ? 'All' : this._esc(t)}</button>
    `).join('');

    nav.querySelectorAll('.bb-filter-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        this.state.activeFilter = btn.dataset.filter;
        this._renderFilters();
        this._renderGrid();
      });
    });
  }

  /* ── Product Grid ─────────────────────────────────────── */

  _renderGrid() {
    const list = document.getElementById('bb-product-list');
    if (!list) return;

    const isFull = this.state.slots.every(Boolean);
    const filtered = this.state.activeFilter === 'all'
      ? this.state.products
      : this.state.products.filter(p => p.product_type === this.state.activeFilter);

    if (!filtered.length) {
      list.innerHTML = '<p class="bb-error">No products found.</p>';
      return;
    }

    list.innerHTML = `<div class="bb-product-grid">${filtered.map(p => this._cardHTML(p, isFull)).join('')}</div>`;

    list.querySelectorAll('.bb-pcard__add-btn[data-pid]').forEach(btn => {
      btn.addEventListener('click', () => {
        const product = this.state.products.find(p => String(p.id) === btn.dataset.pid);
        if (product) this._handleAdd(product);
      });
    });

    list.querySelectorAll('.bb-pcard__details[data-handle]').forEach(btn => {
      btn.addEventListener('click', () => {
        window.open(`/products/${btn.dataset.handle}`, '_blank', 'noopener');
      });
    });
  }

  _cardHTML(p, isFull) {
    const count    = this.state.slots.filter(s => s?.productTitle === p.title).length;
    const img      = p.images?.[0]?.src || '';
    const allSoldOut = p.variants.every(v => !v.available);
    const disabled = (isFull && count === 0) || allSoldOut;

    let btnLabel = 'Add';
    let btnClass = 'bb-pcard__add-btn';
    if (allSoldOut)         { btnLabel = 'Sold Out'; btnClass += ' bb-pcard__add-btn--soldout'; }
    else if (isFull)        { btnLabel = 'Pack Full'; btnClass += ' bb-pcard__add-btn--full'; }

    return `
      <div class="bb-pcard" data-product-id="${p.id}">
        <div class="bb-pcard__image">
          ${img ? `<img src="${img}" alt="${this._esc(p.title)}" loading="lazy">` : ''}
        </div>
        <div class="bb-pcard__info">
          <p class="bb-pcard__name">${this._esc(p.title)}</p>
          <hr class="bb-pcard__divider">
          <button class="bb-pcard__details" data-handle="${p.handle}" type="button">See Details</button>
          <div class="bb-pcard__add-wrap">
            <button
              class="${btnClass}"
              type="button"
              data-pid="${p.id}"
              ${disabled ? 'disabled' : ''}
            >${btnLabel}</button>
            ${count > 0 ? `<span class="bb-pcard__count">${count}</span>` : ''}
          </div>
        </div>
      </div>`;
  }

  /* ── Add / Remove Logic ───────────────────────────────── */

  _handleAdd(product) {
    if (this.state.slots.every(Boolean)) return;

    const availableVariants = product.variants.filter(v => v.available);
    if (!availableVariants.length) return;

    if (availableVariants.length === 1 && product.variants.length === 1) {
      // Single variant — add directly
      const v = availableVariants[0];
      this._addToSlot({
        variantId:    v.id,
        productTitle: product.title,
        variantTitle: v.title !== 'Default Title' ? v.title : '',
        image:        product.images?.[0]?.src || '',
        handle:       product.handle
      });
    } else {
      // Multiple variants → open size drawer
      this._openVariantDrawer(product);
    }
  }

  _addToSlot(item) {
    const idx = this.state.slots.indexOf(null);
    if (idx === -1) return;
    this.state.slots[idx] = item;
    this._refreshUI();
  }

  _removeFromSlot(index) {
    if (index < 0 || index >= this.state.slots.length) return;
    this.state.slots[index] = null;
    this._refreshUI();
  }

  _removeLastOfVariant(variantId) {
    for (let i = this.state.slots.length - 1; i >= 0; i--) {
      if (this.state.slots[i]?.variantId === variantId) {
        this.state.slots[i] = null;
        this._refreshUI();
        return;
      }
    }
  }

  /* ── Refresh All UI ───────────────────────────────────── */

  _refreshUI() {
    this._renderSlots();
    this._renderGrid();
    this._renderMobileItems();
    this._refreshBuyBtns();
  }

  /* ── Desktop Slots ────────────────────────────────────── */

  _renderSlots() {
    const el = document.getElementById('bb-slots');
    if (!el) return;

    el.innerHTML = this.state.slots.map((slot, i) => {
      if (!slot) {
        return `<div class="bb-slot bb-slot--empty">
          <span class="bb-slot__placeholder">Shirt goes here!</span>
        </div>`;
      }
      return `<div class="bb-slot bb-slot--filled">
        ${slot.image
          ? `<img class="bb-slot__thumb" src="${this._esc(slot.image)}" alt="${this._esc(slot.productTitle)}">`
          : '<div class="bb-slot__thumb"></div>'}
        <div class="bb-slot__info">
          <div class="bb-slot__name">${this._esc(slot.productTitle)}</div>
          ${slot.variantTitle ? `<div class="bb-slot__variant">${this._esc(slot.variantTitle)}</div>` : ''}
        </div>
        <button class="bb-slot__remove" type="button" data-idx="${i}" aria-label="Remove">&#10005;</button>
      </div>`;
    }).join('');

    el.querySelectorAll('.bb-slot__remove').forEach(btn => {
      btn.addEventListener('click', () => this._removeFromSlot(parseInt(btn.dataset.idx)));
    });
  }

  /* ── Mobile Bundle List ───────────────────────────────── */

  _renderMobileItems() {
    const el = document.getElementById('bb-mobile-items');
    if (!el) return;

    // Group slots by variantId
    const grouped = new Map();
    this.state.slots.forEach(slot => {
      if (!slot) return;
      const key = slot.variantId;
      const g   = grouped.get(key);
      if (g) {
        g.count++;
      } else {
        grouped.set(key, { slot, count: 1 });
      }
    });

    if (!grouped.size) {
      el.innerHTML = '<p style="text-align:center;padding:16px;color:#999;font-size:13px">No items added yet</p>';
      return;
    }

    el.innerHTML = [...grouped.entries()].map(([vid, { slot, count }]) => `
      <div class="bb-mobile-item">
        ${slot.image
          ? `<img class="bb-mobile-item__thumb" src="${this._esc(slot.image)}" alt="${this._esc(slot.productTitle)}">`
          : '<div class="bb-mobile-item__thumb"></div>'}
        <div class="bb-mobile-item__label">
          <div class="bb-mobile-item__name">${this._esc(slot.productTitle)}</div>
          ${slot.variantTitle ? `<div class="bb-mobile-item__variant">${this._esc(slot.variantTitle)}</div>` : ''}
        </div>
        <div class="bb-mobile-stepper">
          <button class="bb-mobile-stepper__btn" data-vid="${vid}" data-action="dec" type="button">&#8722;</button>
          <span class="bb-mobile-stepper__qty">${count}</span>
          <button class="bb-mobile-stepper__btn" data-vid="${vid}" data-action="inc" type="button">+</button>
        </div>
      </div>
    `).join('');

    el.querySelectorAll('.bb-mobile-stepper__btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const vid = parseInt(btn.dataset.vid);
        if (btn.dataset.action === 'dec') {
          this._removeLastOfVariant(vid);
        } else {
          if (!this.state.slots.every(Boolean)) {
            const existing = this.state.slots.find(s => s?.variantId === vid);
            if (existing) this._addToSlot({ ...existing });
          }
        }
      });
    });
  }

  /* ── Buy Buttons ──────────────────────────────────────── */

  _refreshBuyBtns() {
    const deal   = this.state.activeDeal;
    const filled = this.state.slots.filter(Boolean).length;
    const total  = deal?.qty || 0;
    const isDone = filled === total && total > 0;
    const remain = total - filled;

    const label     = isDone ? 'Add to Cart' : `Add ${remain} more`;
    const mobileLabel = isDone ? 'Add To Cart' : `Add ${remain} more`;

    const desktopBtn = document.getElementById('bb-add-to-cart-btn');
    if (desktopBtn) {
      desktopBtn.textContent = label;
      desktopBtn.disabled    = !isDone;
    }

    const mobileBtn = document.getElementById('bb-mobile-add-btn');
    if (mobileBtn) {
      mobileBtn.textContent = mobileLabel;
      mobileBtn.disabled    = !isDone;
    }

    const toggleText = document.getElementById('bb-mobile-toggle-text');
    if (toggleText) {
      toggleText.textContent = `View Your (${total} pack)`;
    }
  }

  /* ── Variant Drawer ───────────────────────────────────── */

  _openVariantDrawer(product) {
    const title = document.getElementById('bb-drawer-title');
    const body  = document.getElementById('bb-drawer-body');
    if (!body) return;

    if (title) title.textContent = 'Select a Size';

    body.innerHTML = `
      <div class="bb-vdrawer__product">
        ${product.images?.[0]?.src
          ? `<img class="bb-vdrawer__img" src="${this._esc(product.images[0].src)}" alt="${this._esc(product.title)}">`
          : ''}
        <p class="bb-vdrawer__name">${this._esc(product.title)}</p>
      </div>
      <div class="bb-vdrawer__variants">
        ${product.variants.map(v => `
          <button
            class="bb-vdrawer__btn ${!v.available ? 'bb-vdrawer__btn--soldout' : ''}"
            type="button"
            data-vid="${v.id}"
            data-vname="${this._esc(v.title)}"
            ${!v.available ? 'disabled' : ''}
          >${this._esc(v.title)}</button>
        `).join('')}
      </div>`;

    body.querySelectorAll('.bb-vdrawer__btn:not(.bb-vdrawer__btn--soldout)').forEach(btn => {
      btn.addEventListener('click', () => {
        const variantTitle = btn.dataset.vname !== 'Default Title' ? btn.dataset.vname : '';
        this._addToSlot({
          variantId:    parseInt(btn.dataset.vid),
          productTitle: product.title,
          variantTitle,
          image:        product.images?.[0]?.src || '',
          handle:       product.handle
        });
        this._toggleDrawer(false);
      });
    });

    this._toggleDrawer(true);
  }

  _toggleDrawer(open) {
    document.getElementById('bb-drawer')?.classList.toggle('bb-drawer--open', open);
    document.getElementById('bb-overlay')?.classList.toggle('bb-overlay--open', open);
    document.body.style.overflow = open ? 'hidden' : '';
  }

  /* ── Add to Cart ──────────────────────────────────────── */

  async _addToCart() {
    const desktopBtn = document.getElementById('bb-add-to-cart-btn');
    const mobileBtn  = document.getElementById('bb-mobile-add-btn');

    [desktopBtn, mobileBtn].forEach(b => {
      if (b) { b.textContent = 'Adding\u2026'; b.disabled = true; }
    });

    const items = this.state.slots
      .filter(Boolean)
      .map(s => ({
        id:         s.variantId,
        quantity:   1,
        properties: { _bundle: this.state.activeDeal?.title || 'Bundle' }
      }));

    try {
      const res = await fetch('/cart/add.js', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ items })
      });
      if (!res.ok) throw new Error('Cart error');
      window.location.href = window.bbBundleData?.cartUrl || '/cart';
    } catch {
      alert('Sorry, something went wrong. Please try again.');
      this._refreshBuyBtns();
    }
  }

  /* ── UI Bindings ──────────────────────────────────────── */

  _bindUI() {
    // Deal picker clicks
    document.getElementById('bb-deal-btns')?.addEventListener('click', e => {
      const btn  = e.target.closest('.bb-deal-btn');
      if (!btn) return;
      const deal = this.state.deals.find(d => d.el === btn);
      if (deal) this._selectDeal(deal);
    });

    // Close drawer
    document.getElementById('bb-drawer-close')?.addEventListener('click', () => this._toggleDrawer(false));
    document.getElementById('bb-overlay')?.addEventListener('click',       () => this._toggleDrawer(false));

    // Add to cart
    ['bb-add-to-cart-btn', 'bb-mobile-add-btn'].forEach(id => {
      document.getElementById(id)?.addEventListener('click', () => this._addToCart());
    });

    // Mobile bundle toggle
    document.getElementById('bb-mobile-toggle')?.addEventListener('click', () => {
      const bundle  = document.getElementById('bb-mobile-bundle');
      const chevron = document.getElementById('bb-mobile-toggle-chevron');
      const toggle  = document.getElementById('bb-mobile-toggle');
      if (!bundle) return;

      const isOpen = !bundle.hidden;
      bundle.hidden = isOpen;
      chevron?.classList.toggle('bb-mobile-toggle-chevron--open', !isOpen);
      toggle?.setAttribute('aria-expanded', String(!isOpen));

      if (!isOpen) this._renderMobileItems();
    });
  }

  /* ── Helpers ──────────────────────────────────────────── */

  _esc(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}

/* ── Boot ─────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  if (document.getElementById('bundle-builder')) {
    window.bb = new BundleBuilder();
  }
});
