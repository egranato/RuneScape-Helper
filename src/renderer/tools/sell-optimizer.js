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
        this data, so treat it as a starting point, not gospel. For potions,
        it also checks whether decanting to a different dose count before
        selling would net more than selling as-is.
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

    function gcd(a, b) {
      return b === 0 ? a : gcd(b, a % b);
    }

    // Potion dose variants are named like "Prayer potion(4)" in the wiki's
    // item mapping - no space before the parenthesis.
    const DOSE_NAME_PATTERN = /^(.*)\((\d)\)$/;

    let mappingByName = null;
    let potionDoseMap = null;
    let mappingLoaded = false;

    async function ensureMapping() {
      if (mappingLoaded) return;
      lookupStatus.textContent = 'Loading item list...';

      const mapping = await window.api.geMapping();
      mappingByName = new Map();
      potionDoseMap = new Map();
      const names = [];
      for (const item of mapping) {
        mappingByName.set(item.name.toLowerCase(), item);
        names.push(item.name);

        const doseMatch = DOSE_NAME_PATTERN.exec(item.name);
        if (!doseMatch) continue;
        const dose = Number(doseMatch[2]);
        if (dose < 1 || dose > 4) continue;
        const baseName = doseMatch[1];
        if (!potionDoseMap.has(baseName)) potionDoseMap.set(baseName, {});
        potionDoseMap.get(baseName)[dose] = item;
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

        // If this is a potion, check whether decanting to a different dose
        // count before selling beats selling it as-is. Doses are conserved:
        // the smallest whole-number trade between dose A and dose B is
        // lcm(A,B)/A potions of A <-> lcm(A,B)/B potions of B (same as the
        // Decanting Calculator tool). Any leftover that doesn't fill a full
        // batch stays in its original dose and sells at the suggested price
        // computed above.
        const doseMatch = DOSE_NAME_PATTERN.exec(item.name);
        const decantOptions = [];
        if (doseMatch) {
          const fromDose = Number(doseMatch[2]);
          const baseName = doseMatch[1];
          const variants = potionDoseMap.get(baseName);

          if (variants) {
            for (const toDoseKey of Object.keys(variants)) {
              const toDose = Number(toDoseKey);
              if (toDose === fromDose) continue;

              const toItem = variants[toDose];
              const toPriceEntry = latest[toItem.id];
              if (!toPriceEntry || toPriceEntry.high == null || toPriceEntry.low == null) continue;

              const lcm = (fromDose * toDose) / gcd(fromDose, toDose);
              const fromCount = lcm / fromDose;
              const toCount = lcm / toDose;

              const batches = Math.floor(qty / fromCount);
              if (batches <= 0) continue;
              const remainder = qty - batches * fromCount;
              const producedToQty = batches * toCount;

              const toVolEntry = hourly[toItem.id];
              const toHourlyVolume = toVolEntry ? (toVolEntry.highPriceVolume || 0) + (toVolEntry.lowPriceVolume || 0) : 0;
              const toSpread = toPriceEntry.high - toPriceEntry.low;
              const toVolumeRatio = toHourlyVolume > 0 ? producedToQty / toHourlyVolume : Infinity;
              const toPriceFactor = 1 / (1 + toVolumeRatio);
              const toSuggestedPrice = Math.round(toPriceEntry.low + toSpread * toPriceFactor);

              const revenueFromDecanted = producedToQty * (toSuggestedPrice - geTax(toSuggestedPrice));
              const revenueFromRemainder = remainder * (suggestedPrice - geTax(suggestedPrice));
              const totalDecantRevenue = revenueFromDecanted + revenueFromRemainder;

              decantOptions.push({
                toDose,
                toName: toItem.name,
                fromCount,
                toCount,
                batches,
                remainder,
                producedToQty,
                toSuggestedPrice,
                totalDecantRevenue,
                gain: totalDecantRevenue - revenueSuggested,
              });
            }
          }
        }
        decantOptions.sort((a, b) => b.gain - a.gain);
        const bestDecant = decantOptions.length > 0 ? decantOptions[0] : null;

        const candidates = [{ label: 'Grand Exchange at the suggested price', value: revenueSuggested }];
        if (hasHighAlch) candidates.push({ label: 'High alch', value: totalAlchProfit });
        if (bestDecant) candidates.push({ label: `Decant to ${bestDecant.toDose}-dose, then sell`, value: bestDecant.totalDecantRevenue });
        candidates.sort((a, b) => b.value - a.value);
        const winner = candidates[0];
        const runnerUp = candidates[1];

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

            ${doseMatch ? (
              bestDecant ? `
                <div class="muted" style="margin-top: 12px;">Decant before selling?</div>
                <div class="result-line">
                  Decant ${fmt(bestDecant.batches * bestDecant.fromCount)} of your ${item.name}
                  (${fmt(bestDecant.fromCount)} at a time) into ${fmt(bestDecant.producedToQty)} &times; ${bestDecant.toName}
                  ${bestDecant.remainder > 0 ? `, keeping ${fmt(bestDecant.remainder)} un-decanted` : ''}
                </div>
                <div class="result-line">
                  Estimated revenue after decanting:
                  <span class="result-value ${bestDecant.gain >= 0 ? 'profit' : 'loss'}">${fmt(bestDecant.totalDecantRevenue)} gp</span>
                  <span class="${bestDecant.gain >= 0 ? 'profit' : 'loss'}">
                    (${bestDecant.gain >= 0 ? '+' : ''}${fmt(bestDecant.gain)} gp vs. selling as-is)
                  </span>
                </div>
              ` : `
                <div class="muted" style="margin-top: 12px;">
                  Decanting: not enough ${item.name} on hand to make a full batch into another dose, or no other dose variant is trading right now.
                </div>
              `
            ) : ''}

            <div class="result-line" style="margin-top: 12px;">
              Best option:
              <span class="result-value profit">
                ${winner.label}${runnerUp ? ` (+${fmt(winner.value - runnerUp.value)} gp over ${runnerUp.label.toLowerCase()})` : ''}
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
