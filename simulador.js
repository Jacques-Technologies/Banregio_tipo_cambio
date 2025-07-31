const chromium = require('chrome-aws-lambda');
const puppeteer = require('puppeteer-core');

async function simularConvertToMXNConBrowser(moneda = 'USD', cantidad = 100, tipoOperacion = 'compra') {
  const browser = await puppeteer.launch({
    args: chromium.args,
    executablePath: await chromium.executablePath || '/usr/bin/chromium-browser',
    headless: chromium.headless,
    defaultViewport: chromium.defaultViewport
  });

  const page = await browser.newPage();

  try {
    await page.goto('https://www.banregio.com/divisas.php', { waitUntil: 'domcontentloaded', timeout: 30000 });

    await page.waitForSelector('#divisa');
    await page.waitForSelector('.custom-select');
    await page.waitForSelector('#mxn');

    await page.select('.custom-select', moneda);
    await page.click('#divisa');
    await page.keyboard.type(String(cantidad), { delay: 50 });

    const botonTexto = tipoOperacion === 'compra' ? 'Quiero comprar' : 'Quiero vender';

    const [boton] = await page.$x(`//button[contains(., '${botonTexto}')]`);
    if (boton) await boton.click();

    await page.waitForFunction(() => {
      const el = document.querySelector('#mxn');
      return el && parseFloat(el.value) > 0;
    }, { timeout: 5000 });

    const mxn = await page.$eval('#mxn', el => el.value);
    const tipoCambio = (parseFloat(mxn) / cantidad).toFixed(4);

    await browser.close();

    return {
      success: true,
      moneda,
      cantidad: parseFloat(cantidad),
      tipoOperacion,
      mxn: parseFloat(mxn),
      tipoCambio: parseFloat(tipoCambio),
      fuente: 'https://www.banregio.com/divisas.php',
      timestamp: new Date().toISOString()
    };

  } catch (err) {
    await browser.close();
    return {
      success: false,
      error: err.message
    };
  }
}

module.exports = { simularConvertToMXNConBrowser };
