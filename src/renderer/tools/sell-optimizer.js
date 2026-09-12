// Sell Price Optimizer: for a batch of items you already have, compares
// high-alching (nature rune cost only, assumes a fire staff) against selling
// on the Grand Exchange, and suggests a GE listing price.
//
// There's no real order-book depth in the wiki's price data - only the last
// executed insta-buy/insta-sell prices and recent trade counts. So the
// "suggested price" is a heuristic, not a guarantee: it leans toward the
// insta-buy price when your quantity is small next to recent trade volume,
// and toward insta-sell when your quantity would take a long time to clear
// at that pace.
ToolRegistry.register({
  id: 'sell-optimizer',
  name: 'Sell Price Optimizer',

  render(container) {
    container.innerHTML = `
      <h2>Sell Price Optimizer</h2>
      <p class="muted">
        Compares high-alching against selling on the Grand Exchange for a
        batch of items, using live OSRS Wiki prices. High alch profit
        subtracts the nature rune cost (assumes a fire staff, so fire runes
        are free). The suggested GE price is a heuristic based on recent
        trade volume vs. your quantity - there's no real order-book depth in
        this data, so treat it as a starting point, not gospel.
      </p>
      <div class="field">
        <label for="itemName">Item name</label>
        <input type="text" id="itemName" list="itemNameList" placeholder="e.g. Magic shortbow" autocomplete="off" />
        <datalist id="itemNameList"></datalist>
      </div>
      <div class="field">
        <label for="itemQty">How many do you have?</label>
        <input type="number" id="itemQty" min="0" step="1" placeholder="e.g. 5000" />
      </div>
      <button type="button" id="lookupBtn">Look up</button>
      <div class="muted" id="lookupStatus" style="margin-top: 10px;"></div>
      <div id="lookupResult" style="margin-top: 16px;"></div>
    `;

    const itemNameInput = container.querySelector('#itemName');
    const itemNameList = container.querySelector('#itemNameList');
    const itemQtyInput = container.querySelector('#itemQty');
    const lookupBtn = container.querySelector('#lookupBtn');
    const lookupStatus = container.querySelector('#lookupStatus');
    const lookupResult = container.querySelector('#lookupResult');

    const fmt = (n) => Math.round(n).toLocaleString('en-US');

    // Standard Grand Exchange tax: 2% of the sale price, rounded down,
    // exempt under 100gp, capped at 5,000,000 gp per item.
    function geTax(price) {
      if (price < 100) return 0;
      return Math.min(Math.floor(price * 0.02), 5_000_000);
    }

    let mappingByName = null;
    let mappingLoaded = false;

    async function ensureMapping() {
      if (mappingLoaded) return;
      lookupStatus.textContent = 'Loading item list...';

      const mapping = await window.api.geMapping();
      mappingByName = new Map();
      const names = [];
      for (const item of mapping) {
        mappingByName.set(item.name.toLowerCase(), item);
        names.push(item.name);
      }
      names.sort();
      itemNameList.innerHTML = names.map((n) => `<option value="${n}"></option>`).join('');

      mappingLoaded = true;
      lookupStatus.textContent = '';
    }

    itemNameInput.addEventListener('focus', () => {
      ensureMapping().catch((err) => {
        lookupStatus.textContent = `Failed to load item list: ${err.message}`;
      });
    });

    async function runLookup() {
      const name = itemNameInput.value.trim();
      const qty = parseInt(itemQtyInput.value, 10);

      if (!name) {
        lookupStatus.textContent = 'Enter an item name.';
        return;
      }
      if (!Number.isFinite(qty) || qty <= 0) {
        lookupStatus.textContent = 'Enter how many you have.';
        return;
      }

      lookupBtn.disabled = true;
      lookupResult.innerHTML = '';
      lookupStatus.textContent = 'Fetching prices...';

      try {
        await ensureMapping();

        const item = mappingByName.get(name.toLowerCase());
        if (!item) {
          lookupStatus.textContent = `No item matches "${name}" exactly - pick one from the list.`;
          return;
        }

        const natureRune = mappingByName.get('nature rune');
        if (!natureRune) throw new Error('Could not find Nature rune in the item list');

        const [latest, hourly] = await Promise.all([
          window.api.geLatest(),
          window.api.geVolume1h(),
        ]);

        const itemPrice = latest[item.id];
        const runePrice = latest[natureRune.id];

        if (!itemPrice || itemPrice.high == null || itemPrice.low == null) {
          lookupStatus.textContent = `No current price data for ${item.name}.`;
          return;
        }
        if (!runePrice || runePrice.high == null) {
          lookupStatus.textContent = 'No current price data for Nature rune.';
          return;
        }

        const { high, low } = itemPrice;
        const spread = high - low;

        const volEntry = hourly[item.id];
        const hourlyVolume = volEntry ? (volEntry.highPriceVolume || 0) + (volEntry.lowPriceVolume || 0) : 0;

        const volumeRatio = hourlyVolume > 0 ? qty / hourlyVolume : Infinity;
        const priceFactor = 1 / (1 + volumeRatio);
        const suggestedPrice = Math.round(low + spread * priceFactor);

        const revenueAt = (price) => qty * (price - geTax(price));
        const revenueLow = revenueAt(low);
        const revenueHigh = revenueAt(high);
        const revenueSuggested = revenueAt(suggestedPrice);

        const hasHighAlch = item.highalch != null && item.highalch > 0;
        const alchProfitPerItem = hasHighAlch ? item.highalch - runePrice.high : null;
        const totalAlchProfit = hasHighAlch ? qty * alchProfitPerItem : null;

        const alchWins = hasHighAlch && totalAlchProfit > revenueSuggested;

        lookupResult.innerHTML = `
          <div class="card" style="max-width: 560px;">
            <div class="result-line"><strong>${item.name}</strong> &times; ${fmt(qty)}</div>

            <div class="muted" style="margin-top: 12px;">Grand Exchange</div>
            <div class="result-line">Insta-sell (fast, guaranteed): ${fmt(low)} gp &rarr; ${fmt(revenueLow)} gp total</div>
            <div class="result-line">Insta-buy (top price, may sit): ${fmt(high)} gp &rarr; ${fmt(revenueHigh)} gp total</div>
            <div class="result-line">
              Suggested price: <span class="result-value profit">${fmt(suggestedPrice)} gp</span>
              &rarr; <span class="profit">${fmt(revenueSuggested)} gp total</span>
            </div>
            <div class="muted">
              ${hourlyVolume > 0
                ? `Trading ~${fmt(hourlyVolume)}/hr recently - your ${fmt(qty)} is about ${volumeRatio.toFixed(1)}x an hour's typical volume.`
                : 'No measured trades in the last hour for this item - treat any price estimate here with caution.'}
            </div>

            ${hasHighAlch ? `
              <div class="muted" style="margin-top: 12px;">High Alchemy (assumes a fire staff, nature rune only)</div>
              <div class="result-line">High alch value: ${fmt(item.highalch)} gp</div>
              <div class="result-line">Nature rune cost: ${fmt(runePrice.high)} gp</div>
              <div class="result-line">
                Alch profit per item: <span class="result-value ${alchProfitPerItem >= 0 ? 'profit' : 'loss'}">${fmt(alchProfitPerItem)} gp</span>
                &rarr; <span class="${totalAlchProfit >= 0 ? 'profit' : 'loss'}">${fmt(totalAlchProfit)} gp total</span>
              </div>
            ` : `
              <div class="muted" style="margin-top: 12px;">This item can't be high alched.</div>
            `}

            <div class="result-line" style="margin-top: 12px;">
              Best option:
              <span class="result-value profit">
                ${alchWins
                  ? `High alch (+${fmt(totalAlchProfit - revenueSuggested)} gp over the suggested GE price)`
                  : `Grand Exchange at the suggested price${hasHighAlch ? ` (+${fmt(revenueSuggested - totalAlchProfit)} gp over alching)` : ''}`}
              </span>
            </div>
          </div>
        `;

        lookupStatus.textContent = '';
      } catch (err) {
        console.error('sell optimizer lookup failed', err);
        lookupStatus.textContent = `Failed to fetch prices: ${err.message}`;
      } finally {
        lookupBtn.disabled = false;
      }
    }

    lookupBtn.addEventListener('click', runLookup);
    itemNameInput.focus();
  },
});
