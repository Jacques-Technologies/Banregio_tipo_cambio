const chromium = require('@sparticuz/chromium');
const puppeteer = require('puppeteer-core');

async function simularConvertToMXNConBrowser(moneda = 'USD', cantidad = 100, tipoOperacion = 'compra') {
  let browser = null;
  
  try {
    browser = await puppeteer.launch({
      args: [
        ...chromium.args,
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu'
      ],
      executablePath: await chromium.executablePath,
      headless: chromium.headless,
      defaultViewport: chromium.defaultViewport
    });

    const page = await browser.newPage();
    
    await page.goto('https://www.banregio.com/divisas.php', { 
      waitUntil: 'domcontentloaded', 
      timeout: 30000 
    });
    
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
    return {
      success: false,
      error: err.message
    };
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

module.exports = { simularConvertToMXNConBrowser };
