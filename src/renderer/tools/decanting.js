// Decanting profit calculator.
//
// Doses are conserved, not potion count: 4 potions of the 3-dose version
// hold the same total doses (12) as 3 potions of the 4-dose version. So the
// smallest whole-number trade between dose A and dose B is
// lcm(A,B)/A potions of A <-> lcm(A,B)/B potions of B.
ToolRegistry.register({
  id: 'decanting',
  name: 'Decanting Calculator',

  render(container) {
    container.innerHTML = `
      <h2>Decanting Calculator</h2>
      <p class="muted">
        Pulls live prices from the OSRS Wiki and lists every potion with a
        profitable 3-dose/4-dose or 1-dose/2-dose decant right now, sorted by
        profit per batch. Uses the midpoint of each item's insta-buy/insta-sell
        price and includes the 2% GE tax on the potion you'd be selling.
        Volume is the smaller of the two potions' trade count over the last
        hour - the side that would bottleneck you. Enter a buy quantity on
        any row to see total profit. Click a column header to re-sort, or
        click a row to see its recommended buy/sell prices above the table.
      </p>
      <div class="field" style="display: flex; align-items: center; gap: 8px;">
        <input type="checkbox" id="hideLowVolume" checked style="width: auto;" />
        <label for="hideLowVolume" style="margin: 0;">Hide low / very low volume potions</label>
      </div>
      <button type="button" id="scanBtn">Check prices</button>
      <div class="muted" id="scanStatus" style="margin-top: 10px;"></div>
      <div id="selectedPrice" style="margin-top: 12px;"></div>
      <div id="scanResults" style="margin-top: 12px;"></div>
    `;

    const scanBtn = container.querySelector('#scanBtn');
    const scanStatus = container.querySelector('#scanStatus');
    const scanResults = container.querySelector('#scanResults');
    const selectedPriceEl = container.querySelector('#selectedPrice');
    const hideLowVolumeCheckbox = container.querySelector('#hideLowVolume');

    const fmt = (n) => Math.round(n).toLocaleString('en-US');

    // Standard Grand Exchange tax: 2% of the sale price, rounded down,
    // exempt under 100gp, capped at 5,000,000 gp per item.
    function geTax(price) {
      if (price < 100) return 0;
      return Math.min(Math.floor(price * 0.02), 5_000_000);
    }

    function gcd(a, b) {
      return b === 0 ? a : gcd(b, a % b);
    }

    function bestDecantDirection(doseA, priceA, doseB, priceB) {
      const totalDoses = (doseA * doseB) / gcd(doseA, doseB);
      const countA = totalDoses / doseA;
      const countB = totalDoses / doseB;

      const profitAtoB = countB * (priceB - geTax(priceB)) - countA * priceA;
      const profitBtoA = countA * (priceA - geTax(priceA)) - countB * priceB;

      if (profitAtoB <= 0 && profitBtoA <= 0) return null;

      return profitAtoB > profitBtoA
        ? { fromDose: doseA, toDose: doseB, fromCount: countA, toCount: countB, batchProfit: profitAtoB }
        : { fromDose: doseB, toDose: doseA, fromCount: countB, toCount: countA, batchProfit: profitBtoA };
    }

    // Potion dose variants are named like "Prayer potion(4)" in the wiki's
    // item mapping - no space before the parenthesis.
    const DOSE_NAME_PATTERN = /^(.*)\((\d)\)$/;
    const DOSE_PAIRS = [
      [3, 4],
      [1, 2],
    ];

    // Trailing-1h trade count thresholds. Below "Low", an item can easily
    // take days/weeks to fully offload at any real volume.
    function volumeTier(v) {
      if (v >= 1000) return { label: 'High', className: 'vol-high' };
      if (v >= 100) return { label: 'Medium', className: 'vol-medium' };
      if (v >= 10) return { label: 'Low', className: 'vol-low' };
      return { label: 'Very low', className: 'vol-verylow' };
    }

    function totalProfitFor(o, buyQty) {
      if (!Number.isFinite(buyQty) || buyQty <= 0) return null;
      const completeBatches = Math.floor(buyQty / o.fromCount);
      return {
        completeBatches,
        leftover: buyQty % o.fromCount,
        totalProfit: completeBatches * o.batchProfit,
        potionsProduced: completeBatches * o.toCount,
      };
    }

    let currentOpportunities = [];
    let hasScanned = false;
    let sortState = { key: 'batchProfit', dir: 'desc' };
    let selectedOpportunity = null;

    function renderSelectedPrice() {
      if (!selectedOpportunity) {
        selectedPriceEl.innerHTML = '';
        return;
      }

      const o = selectedOpportunity;
      selectedPriceEl.innerHTML = `
        <div class="card" style="max-width: 560px;">
          <div class="result-line"><strong>${o.name}</strong> (${o.fromDose}-dose &rarr; ${o.toDose}-dose)</div>
          <div class="price-copy-row">
            <span class="muted">Recommended buy price (${o.fromDose}-dose)</span>
            <span class="result-value profit">${fmt(o.fromHigh)} gp</span>
            <button type="button" class="copy-btn" data-copy="${o.fromHigh}">Copy</button>
          </div>
          <div class="price-copy-row">
            <span class="muted">Recommended sell price (${o.toDose}-dose)</span>
            <span class="result-value profit">${fmt(o.toLow)} gp</span>
            <button type="button" class="copy-btn" data-copy="${o.toLow}">Copy</button>
          </div>
        </div>
      `;

      for (const btn of selectedPriceEl.querySelectorAll('.copy-btn')) {
        btn.addEventListener('click', async () => {
          try {
            await window.api.copyToClipboard(btn.dataset.copy);
            const original = btn.textContent;
            btn.textContent = 'Copied!';
            setTimeout(() => {
              btn.textContent = original;
            }, 1200);
          } catch (err) {
            console.error('copy failed', err);
          }
        });
      }
    }

    function renderTable() {
      if (!hasScanned) return;

      const { key, dir } = sortState;
      const factor = dir === 'asc' ? 1 : -1;
      currentOpportunities.sort((a, b) => factor * (a[key] - b[key]));

      const hideLowVolume = hideLowVolumeCheckbox.checked;
      const visible = hideLowVolume
        ? currentOpportunities.filter((o) => {
            const tier = volumeTier(o.bottleneckVolume).label;
            return tier !== 'Low' && tier !== 'Very low';
          })
        : currentOpportunities;

      if (currentOpportunities.length === 0) {
        scanResults.innerHTML = '<div class="muted">No profitable decanting opportunities found right now.</div>';
        return;
      }

      if (visible.length === 0) {
        scanResults.innerHTML = '<div class="muted">Nothing left after hiding low-volume potions - try unchecking the box above.</div>';
        return;
      }

      const arrow = (colKey) => (key === colKey ? (dir === 'asc' ? ' ↑' : ' ↓') : '');

      scanResults.innerHTML = `
        <table class="scan-table">
          <thead>
            <tr>
              <th>Potion</th>
              <th>Decant</th>
              <th class="sortable" data-sort="batchProfit">Profit / batch${arrow('batchProfit')}</th>
              <th>Profit / potion</th>
              <th class="sortable" data-sort="bottleneckVolume">Volume (1h)${arrow('bottleneckVolume')}</th>
              <th>Buy qty</th>
              <th>Total profit</th>
            </tr>
          </thead>
          <tbody>
            ${visible
              .map((o, idx) => {
                const tier = volumeTier(o.bottleneckVolume);
                const result = totalProfitFor(o, o.buyQty);

                return `
                  <tr data-idx="${idx}" class="${o === selectedOpportunity ? 'selected' : ''}">
                    <td>${o.name}</td>
                    <td>${o.fromDose}-dose &rarr; ${o.toDose}-dose</td>
                    <td class="profit">${fmt(o.batchProfit)} gp</td>
                    <td class="profit">${fmt(o.batchProfit / o.toCount)} gp</td>
                    <td>
                      <span class="vol-badge ${tier.className}">${tier.label}</span>
                      <span class="muted">${fmt(o.bottleneckVolume)}/hr</span>
                    </td>
                    <td>
                      <input
                        type="number" class="qty-input" min="0" step="1"
                        placeholder="e.g. 500"
                        value="${o.buyQty ?? ''}"
                      />
                    </td>
                    <td class="profit qty-total">${result ? fmt(result.totalProfit) + ' gp' : '—'}</td>
                  </tr>
                `;
              })
              .join('')}
          </tbody>
        </table>
      `;

      for (const th of scanResults.querySelectorAll('th.sortable')) {
        th.addEventListener('click', () => {
          const sortKey = th.dataset.sort;
          sortState = sortState.key === sortKey
            ? { key: sortKey, dir: sortState.dir === 'asc' ? 'desc' : 'asc' }
            : { key: sortKey, dir: 'desc' };
          renderTable();
        });
      }

      for (const tr of scanResults.querySelectorAll('tr[data-idx]')) {
        const o = visible[Number(tr.dataset.idx)];
        const qtyInput = tr.querySelector('.qty-input');
        const totalCell = tr.querySelector('.qty-total');

        qtyInput.addEventListener('input', () => {
          const qty = parseInt(qtyInput.value, 10);
          o.buyQty = Number.isFinite(qty) && qty > 0 ? qty : undefined;
          const result = totalProfitFor(o, o.buyQty);
          totalCell.textContent = result ? `${fmt(result.totalProfit)} gp` : '—';
        });

        tr.addEventListener('click', (e) => {
          if (e.target.closest('.qty-input')) return;

          selectedOpportunity = o;
          renderSelectedPrice();

          for (const rowEl of scanResults.querySelectorAll('tr[data-idx]')) {
            rowEl.classList.toggle('selected', visible[Number(rowEl.dataset.idx)] === selectedOpportunity);
          }
        });
      }
    }

    async function runScan() {
      scanBtn.disabled = true;
      scanStatus.textContent = 'Fetching item list and prices...';
      scanResults.innerHTML = '';
      selectedOpportunity = null;
      renderSelectedPrice();

      try {
        const [mapping, latest, hourly] = await Promise.all([
          window.api.geMapping(),
          window.api.geLatest(),
          window.api.geVolume1h(),
        ]);

        const potionsByName = new Map();
        for (const item of mapping) {
          const match = DOSE_NAME_PATTERN.exec(item.name);
          if (!match) continue;
          const dose = Number(match[2]);
          if (dose < 1 || dose > 4) continue;

          const baseName = match[1];
          if (!potionsByName.has(baseName)) potionsByName.set(baseName, {});
          potionsByName.get(baseName)[dose] = item.id;
        }

        const midPrice = (id) => {
          const entry = latest[id];
          if (!entry || entry.high == null || entry.low == null) return null;
          return (entry.high + entry.low) / 2;
        };

        const hourlyVolume = (id) => {
          const entry = hourly[id];
          if (!entry) return 0;
          return (entry.highPriceVolume || 0) + (entry.lowPriceVolume || 0);
        };

        const opportunities = [];
        for (const [name, doseIds] of potionsByName) {
          for (const [doseA, doseB] of DOSE_PAIRS) {
            const idA = doseIds[doseA];
            const idB = doseIds[doseB];
            if (!idA || !idB) continue;

            const priceA = midPrice(idA);
            const priceB = midPrice(idB);
            if (priceA == null || priceB == null) continue;

            const direction = bestDecantDirection(doseA, priceA, doseB, priceB);
            if (!direction) continue;

            const bottleneckVolume = Math.min(hourlyVolume(idA), hourlyVolume(idB));

            const entryA = latest[idA];
            const entryB = latest[idB];
            const [fromEntry, toEntry] = direction.fromDose === doseA ? [entryA, entryB] : [entryB, entryA];

            opportunities.push({
              name,
              ...direction,
              bottleneckVolume,
              fromHigh: fromEntry.high,
              fromLow: fromEntry.low,
              toHigh: toEntry.high,
              toLow: toEntry.low,
            });
          }
        }

        currentOpportunities = opportunities;
        hasScanned = true;
        renderTable();

        scanStatus.textContent = `Checked ${potionsByName.size} potions - ${opportunities.length} profitable right now.`;
      } catch (err) {
        console.error('price scan failed', err);
        scanStatus.textContent = `Failed to fetch prices: ${err.message}`;
      } finally {
        scanBtn.disabled = false;
      }
    }

    scanBtn.addEventListener('click', runScan);
    hideLowVolumeCheckbox.addEventListener('change', renderTable);
  },
});
