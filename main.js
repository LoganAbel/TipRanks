import fs from 'fs';
import { getStreamAsArray } from 'get-stream';
import { parse } from 'csv-parse';
import puppeteer from 'puppeteer';

// import StealthPlugin from 'puppeteer-extra-plugin-stealth';
// puppeteer.use(StealthPlugin())

const readCSVData = async filePath => 
	await getStreamAsArray(
		fs.createReadStream(filePath).pipe(parse({delimiter: ','}))
	)

const catcher = promise => 
	promise.then(data => [null, data]).catch(err => [err, null])

const wait = async t => await new Promise(resolve => setTimeout(resolve, t))

const waitForEnter = (() => {
	let fn = null
	process.stdin.on('data', data => {
		if (fn) {
			fn(data)
			fn = null
		}
	})
	return () => new Promise(resolve => { fn = resolve })
})()

;(async () => {

	const tickers = (await readCSVData('tickers.csv')).map(([v]) => v)
	const res = {}

	const browser = await puppeteer.launch({ headless: true, defaultViewport: null })
	const [page] = await browser.pages()
	await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/74.0.3729.169 Safari/537.36')

	const textSelector = txt => `::-p-xpath(//*[text()="${txt}"])`
	const orTextSelector = (...txtArr) => `::-p-xpath(//*[${txtArr.map(txt => `text()="${txt}"`).join(' or ')}])`
	const textExists = async txt => await page.$(textSelector(txt)) != null
	const getTextContent = async path => {
		const element = await page.waitForSelector(path)
		return await element.evaluate(el => el.textContent)
	}

	for (let ticker_i = 0; ticker_i < tickers.length; ticker_i++) 
	{	
		const ticker = tickers[ticker_i].toLowerCase().trim()

		await page.goto(`https://www.tipranks.com/stocks/${ticker}`)

		if (await page.$(orTextSelector('Page Not Found', 'Something went wrong!')) != null) {
			const row = [ticker, null, null, null, null, null]
			console.log(...row)
			res[ticker] = row
			continue;
		}

		await page.waitForSelector(orTextSelector('Open in App', 'Go Premium'))

		const rating = await getTextContent("::-p-xpath(//*[name()='polygon']/../*[name()='text'])")

		let price_tag = await page.$("::-p-xpath(//h3[text()='Average Price Target']/../div[1])")
		let price = price_tag == null ? null : await price_tag.evaluate(el => el.textContent)
		if (price) price = price.slice(0,price.indexOf('(')-1)
		if (price && !price.startsWith('$')) price = null

		let buy = null
		let hold = null
		let sell = null
		if (price) 
		{
			await page.goto(`https://www.tipranks.com/stocks/${ticker}/forecast`)
			if (await textExists("Suspicious Activity Detected")) {
				console.log("Suspicious Activity Detected. Change IP address and then press enter to continue, or type exit to end")
				const inp = await waitForEnter()
				if (inp.includes("exit")) break;
				ticker_i --;
				continue;
			}
			buy = await getTextContent('::-p-xpath(//div[text()=" Buy"]/span)')
			hold = await getTextContent('::-p-xpath(//div[text()=" Hold"]/span)')
			sell = await getTextContent('::-p-xpath(//div[text()=" Sell"]/span)')
		}

		const row = [ticker, rating, price, buy, hold, sell]
		console.log(...row)
		res[ticker] = row

		await wait(Math.random()*500 + 1500)
	}

	await page.close()
	await browser.close()

	fs.writeFileSync('data.csv', Object.values(res).map(row => 
		row.map(str =>
			str && [...str].filter(c => c != ',').join('')
		).join(',')
	).join('\n'))
	process.exit()
})()
