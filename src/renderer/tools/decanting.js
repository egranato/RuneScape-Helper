// Decanting profit calculator.
//
// Doses are conserved, not potion count: 4 potions of the 3-dose version
// hold the same total doses (12) as 3 potions of the 4-dose version. So the
// only two batch sizes that make sense to compare are "4x 3-dose" against
// "3x 4-dose" - that's the smallest whole-number trade in each direction.
ToolRegistry.register({
  id: 'decanting',
  name: 'Decanting Calculator',

  render(container) {
    container.innerHTML = `
      <h2>Decanting Calculator</h2>
      <p class="muted">
        Enter the price of the 3-dose and 4-dose versions of a potion.
        4x 3-dose = 3x 4-dose in total doses, so that's the batch this
        compares. Includes the 2% GE tax on whichever potion you'd be
        selling.
      </p>
      <div class="field">
        <label for="price3">Price per 3-dose potion</label>
        <input type="number" id="price3" min="0" step="1" placeholder="e.g. 900" />
      </div>
      <div class="field">
        <label for="price4">Price per 4-dose potion</label>
        <input type="number" id="price4" min="0" step="1" placeholder="e.g. 1250" />
      </div>
      <div class="card" id="result">
        <div class="muted">Enter both prices to see which direction profits.</div>
      </div>

      <div class="field" style="margin-top: 20px;">
        <label id="buyQtyLabel" for="buyQty">How many will you buy?</label>
        <input type="number" id="buyQty" min="0" step="1" placeholder="e.g. 500" />
      </div>
      <div class="card" id="qtyResult">
        <div class="muted">Enter prices and a quantity to see total profit.</div>
      </div>
    `;

    const price3Input = container.querySelector('#price3');
    const price4Input = container.querySelector('#price4');
    const resultEl = container.querySelector('#result');
    const buyQtyLabel = container.querySelector('#buyQtyLabel');
    const buyQtyInput = container.querySelector('#buyQty');
    const qtyResultEl = container.querySelector('#qtyResult');

    const fmt = (n) =>
      Math.round(n).toLocaleString('en-US');

    // Standard Grand Exchange tax: 2% of the sale price, rounded down,
    // exempt under 100gp, capped at 5,000,000 gp per item.
    function geTax(price) {
      if (price < 100) return 0;
      return Math.min(Math.floor(price * 0.02), 5_000_000);
    }

    function update() {
      const price3 = parseFloat(price3Input.value);
      const price4 = parseFloat(price4Input.value);

      if (!Number.isFinite(price3) || !Number.isFinite(price4) || price3 < 0 || price4 < 0) {
        resultEl.innerHTML = '<div class="muted">Enter both prices to see which direction profits.</div>';
        qtyResultEl.innerHTML = '<div class="muted">Enter prices and a quantity to see total profit.</div>';
        return;
      }

      const tax3 = geTax(price3);
      const tax4 = geTax(price4);

      // Buy 4x 3-dose (no tax on buying), decant into 3x 4-dose, sell those (taxed).
      const revenue3to4 = 3 * (price4 - tax4);
      const cost3to4 = 4 * price3;
      const profit3to4 = revenue3to4 - cost3to4;

      // Buy 3x 4-dose, decant into 4x 3-dose, sell those (taxed).
      const revenue4to3 = 4 * (price3 - tax3);
      const cost4to3 = 3 * price4;
      const profit4to3 = revenue4to3 - cost4to3;

      if (profit3to4 <= 0 && profit4to3 <= 0) {
        resultEl.innerHTML = `
          <div class="result-line">No profit either direction</div>
          <div class="muted">After 2% GE tax, neither decanting direction comes out ahead.</div>
        `;
        buyQtyLabel.textContent = 'How many will you buy?';
        qtyResultEl.innerHTML = '<div class="muted">No profitable direction, so there\'s nothing to total.</div>';
        return;
      }

      const decantUp = profit3to4 > profit4to3;
      const batchProfit = decantUp ? profit3to4 : profit4to3;
      const taxPaid = decantUp ? 3 * tax4 : 4 * tax3;
      const perFinalPotion = decantUp ? batchProfit / 3 : batchProfit / 4;

      resultEl.innerHTML = `
        <div class="result-line">
          Decant <span class="result-value profit">${decantUp ? '3-dose → 4-dose' : '4-dose → 3-dose'}</span>
        </div>
        <div class="result-line">
          Profit per batch (${decantUp ? '4x 3-dose → 3x 4-dose' : '3x 4-dose → 4x 3-dose'}):
          <span class="result-value profit">${fmt(batchProfit)} gp</span>
        </div>
        <div class="muted">= ${fmt(perFinalPotion)} gp per ${decantUp ? '4-dose' : '3-dose'} potion produced</div>
        <div class="muted">GE tax paid on batch: ${fmt(taxPaid)} gp</div>
      `;

      // Buy-side potion is whatever you purchase before decanting;
      // its batch size is how many of it make up one full batch.
      const buyLabel = decantUp ? '3-dose' : '4-dose';
      const sellLabel = decantUp ? '4-dose' : '3-dose';
      const buyBatchSize = decantUp ? 4 : 3;
      const sellBatchSize = decantUp ? 3 : 4;

      buyQtyLabel.textContent = `How many ${buyLabel} potions will you buy?`;

      const buyQty = parseInt(buyQtyInput.value, 10);
      if (!Number.isFinite(buyQty) || buyQty <= 0) {
        qtyResultEl.innerHTML = `<div class="muted">Enter how many ${buyLabel} potions you'll buy to see total profit.</div>`;
        return;
      }

      const completeBatches = Math.floor(buyQty / buyBatchSize);
      const leftover = buyQty % buyBatchSize;
      const totalProfit = completeBatches * batchProfit;
      const potionsProduced = completeBatches * sellBatchSize;

      qtyResultEl.innerHTML = `
        <div class="result-line">
          Total profit from ${fmt(buyQty)} ${buyLabel} potions:
          <span class="result-value profit">${fmt(totalProfit)} gp</span>
        </div>
        <div class="muted">= ${fmt(completeBatches)} batches → ${fmt(potionsProduced)} ${sellLabel} potions sold</div>
        ${leftover > 0
          ? `<div class="muted">${fmt(leftover)} ${buyLabel} potion(s) left over - not enough to fill another batch, ignored in this total.</div>`
          : ''}
      `;
    }

    price3Input.addEventListener('input', update);
    price4Input.addEventListener('input', update);
    buyQtyInput.addEventListener('input', update);
    price3Input.focus();
  },
});
