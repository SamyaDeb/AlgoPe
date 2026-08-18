# AlgoPe Provider Developer Setup

**Monetize your APIs with x402 payments - earn real ALGO for every API call.**

---

## 🚀 5-Minute Setup

### Step 1: Install AlgoPe Provider Package

```bash
npm install -g @algope/algope
```

Or use it in your project:

```bash
npm install @algope/algope
```

### Step 2: Get Your Algorand Wallet Address

You need a wallet address to receive payments (NOT the mnemonic):

1. Open any Algorand wallet (Pera, Defly, etc.)
2. Copy your wallet address (starts with uppercase letters)
3. **Important**: You only need the ADDRESS, not the private key or mnemonic

**Why no mnemonic?** AlgoPe uses a secure verifier pattern - payments are sent directly to your wallet on-chain. The proxy only verifies transactions, never needs to sign anything.

### Step 3: Initialize Provider Configuration

```bash
cd packages/algope
algope init
```

The interactive setup will ask:

```
? Service Name › Weather API
? Service Description › Real-time weather data
? Backend API URL › http://localhost:3001
? Price per Request (ALGO) › 0.05
? Payment Token › ALGO
? Your Wallet Address › EZDWPOTBKBWCBQ4M6QXWF4Z3PJB5Q6XN6XA...
? Proxy Port › 4402
? Network › testnet
```

This creates `~/.algope/config.json`

### Step 4: Start Your Backend API

Your backend API should run independently. Example:

```javascript
// backend-api.js
import express from 'express';
const app = express();

app.get('/weather', (req, res) => {
  const city = req.query.city;
  res.json({
    city: city,
    temp: 72,
    condition: "Sunny"
  });
});

app.listen(3001, () => {
  console.log('Backend API running on port 3001');
});
```

Run it:
```bash
node backend-api.js
```

### Step 5: Start the x402 Payment Gateway

```bash
algope start
```

Expected output:
```
  _____ _           _       _____     
 / ____| |         (_)     |  __ \    
| |    | |__   __ _ _ _ __ | |__) |__ 
| |    | '_ \ / _` | | '_ \|  ___/ _ \
| |____| | | | (_| | | | | | |  |  __/
 \_____|_| |_|\__,_|_|_| |_|_|   \___|

AI Agent Marketplace on Algorand • x402 Micropayments

Starting x402 payment gateway...

Configuration:
  Service:  Weather API
  Target:   http://localhost:3001
  Price:    0.05 ALGO
  Wallet:   EZDWPOTB...57A4
  Network:  testnet

✓ AlgoPe proxy started
  Listening on: http://localhost:4402
```

Your API is now protected by x402 payments! 🎉

### Step 6: Register Your Service

Register in the on-chain registry so agents can discover your service:

```bash
algope register
```

This creates an Algorand transaction to register your service in the smart contract registry.

**Or register locally for testing:**
```bash
algope register --local
```

---

## 📊 How It Works

```
Agent Request → x402 Proxy (port 4402) → Check Payment
                    ↓                           ↓
              No Payment?              Payment Valid?
                    ↓                           ↓
            402 Payment Required          Forward to Backend API
                    ↓                           ↓
              Return Payment Info        Return API Response
```

**Payment Flow:**
1. Agent calls your API endpoint
2. Proxy returns `402 Payment Required` with payment details
3. Agent creates and signs ALGO transaction
4. Agent retries request with transaction proof
5. Proxy verifies transaction on Algorand blockchain
6. Proxy forwards request to your backend
7. Your backend returns data
8. Payment lands in YOUR wallet on-chain

---

## 🔧 Configuration Reference

### Config File Location

`~/.algope/config.json`

### Config Structure

```json
{
  "serviceName": "Weather API",
  "serviceDescription": "Real-time weather data with forecasts",
  "tags": ["weather", "forecast", "data"],
  "targetUrl": "http://localhost:3001",
  "pricePerRequest": "0.05",
  "paymentToken": "ALGO",
  "walletAddress": "YOUR_WALLET_ADDRESS_HERE",
  "proxyPort": 4402,
  "network": "testnet",
  "logLevel": "normal"
}
```

### Configuration Options

| Field | Description | Example |
|-------|-------------|---------|
| `serviceName` | Your service name | "Weather API" |
| `serviceDescription` | Short description | "Real-time weather data" |
| `tags` | Searchable tags | ["weather", "data"] |
| `targetUrl` | Your backend API URL | "http://localhost:3001" |
| `pricePerRequest` | Price in ALGO | "0.05" |
| `paymentToken` | Payment currency | "ALGO" or "USDC" |
| `walletAddress` | Your receiving address | "EZDW..." |
| `proxyPort` | x402 proxy port | 4402 |
| `network` | Algorand network | "testnet" or "mainnet" |
| `logLevel` | Log verbosity | "normal" or "verbose" |

---

## 🛠️ CLI Commands

| Command | Description | Example |
|---------|-------------|---------|
| `algope init` | Initialize provider config | `algope init` |
| `algope start` | Start x402 payment gateway | `algope start` |
| `algope start --port 5000` | Start on custom port | `algope start --port 5000` |
| `algope register` | Register service on-chain | `algope register` |
| `algope register --local` | Register in local registry | `algope register --local` |
| `algope status` | Show service status | `algope status` |

---

## 🎯 Examples

### Example 1: Simple REST API

```javascript
// weather-api.js
import express from 'express';
const app = express();

const weatherData = {
  london: { temp: 58, condition: "Rainy" },
  paris: { temp: 65, condition: "Cloudy" },
  tokyo: { temp: 68, condition: "Clear" }
};

app.get('/weather', (req, res) => {
  const city = req.query.city?.toLowerCase();
  const data = weatherData[city];
  
  if (!data) {
    return res.status(404).json({ error: "City not found" });
  }
  
  res.json({
    city: city,
    temperature: data.temp,
    condition: data.condition,
    timestamp: new Date().toISOString()
  });
});

app.listen(3001);
```

**Monetize it:**
```bash
# Terminal 1: Start backend
node weather-api.js

# Terminal 2: Start x402 proxy
algope start --port 4402 --backend http://localhost:3001
```

### Example 2: Express with Multiple Endpoints

```javascript
// data-api.js
import express from 'express';
const app = express();

app.get('/stock/:symbol', (req, res) => {
  res.json({
    symbol: req.params.symbol,
    price: 150.25,
    change: +2.5
  });
});

app.get('/news', (req, res) => {
  res.json({
    articles: [
      { title: "Breaking news", url: "..." }
    ]
  });
});

app.get('/analytics', (req, res) => {
  res.json({
    insights: ["Trend is up", "Volume increasing"]
  });
});

app.listen(3001);
```

**Configuration for multiple endpoints:**
```json
{
  "serviceName": "Financial Data API",
  "targetUrl": "http://localhost:3001",
  "pricePerRequest": "0.1",
  "routes": {
    "/stock/*": "0.05",
    "/news": "0.03",
    "/analytics": "0.15"
  }
}
```

### Example 3: Python Flask API

```python
# app.py
from flask import Flask, jsonify, request

app = Flask(__name__)

@app.route('/analyze')
def analyze():
    text = request.args.get('text', '')
    return jsonify({
        'sentiment': 'positive',
        'score': 0.85,
        'text_length': len(text)
    })

if __name__ == '__main__':
    app.run(port=3001)
```

**Monetize it:**
```bash
# Terminal 1: Start Flask
python app.py

# Terminal 2: Start x402 proxy
algope start --port 4402 --backend http://localhost:3001
```

---

## 💰 Pricing Strategies

### Fixed Price per Request
```json
{
  "pricePerRequest": "0.05"
}
```
Every API call costs 0.05 ALGO

### Tiered Pricing (Future Feature)
```json
{
  "routes": {
    "/basic/*": "0.01",
    "/premium/*": "0.1",
    "/enterprise/*": "1.0"
  }
}
```

### Usage-Based Pricing Ideas
- Image generation: Price by resolution
- Data analysis: Price by input size
- Compute: Price by processing time

---

## 📈 Monitoring Revenue

### Check Wallet Balance

```bash
# Check your wallet on Algorand explorer
open "https://testnet.explorer.perawallet.app/address/YOUR_ADDRESS"
```

### Track Transactions

The proxy logs all successful payments:
```
[12:34:56] ✓ Payment verified: 0.05 ALGO
[12:35:02] ✓ Payment verified: 0.05 ALGO
[12:35:15] ✓ Payment verified: 0.05 ALGO
```

### View in Explorer

All payments land directly in your wallet on-chain. View them at:
- Testnet: https://testnet.explorer.perawallet.app/
- Mainnet: https://explorer.perawallet.app/

---

## 🔐 Security

### Your Wallet is Secure

- Proxy NEVER needs your mnemonic
- Proxy only verifies transactions, never signs
- Payments go directly to your wallet on-chain
- No custodial risk

### Best Practices

1. **Use a dedicated wallet** for receiving payments
2. **Monitor transactions** on Algorand explorer
3. **Rate limit** your backend API
4. **Validate inputs** in your backend
5. **Use HTTPS** in production

---

## 🚀 Going to Production

### Checklist

- [ ] Test on testnet thoroughly
- [ ] Switch `network` to `mainnet` in config
- [ ] Use a mainnet wallet address
- [ ] Set appropriate pricing
- [ ] Configure HTTPS/SSL
- [ ] Set up monitoring
- [ ] Register service on mainnet

### Deployment Options

**Docker:**
```dockerfile
FROM node:18
WORKDIR /app
COPY . .
RUN npm install -g @algope/algope
CMD ["algope", "start"]
```

**Systemd Service:**
```ini
[Unit]
Description=AlgoPe x402 Gateway

[Service]
ExecStart=/usr/local/bin/algope start
Restart=always

[Install]
WantedBy=multi-user.target
```

**Cloud Providers:**
- Deploy on AWS, GCP, Azure
- Use managed Algorand nodes
- Scale horizontally

---

## 🐛 Troubleshooting

### "Cannot connect to backend"
- Verify backend API is running
- Check `targetUrl` in config
- Test backend directly: `curl http://localhost:3001/your-endpoint`

### "Port already in use"
- Change `proxyPort` in config
- Or stop the process using the port: `lsof -ti:4402 | xargs kill`

### "Transaction verification failed"
- Check network is correct (testnet vs mainnet)
- Verify wallet address is correct
- Ensure agent has sufficient ALGO

### "Service not discoverable"
- Run `algope register` to register on-chain
- Check registry: `algope services` (from agent side)
- Verify tags are descriptive

---

## 📚 Next Steps

1. **Build your API** - Any REST API works
2. **Protect with x402** - Start the proxy
3. **Register your service** - Make it discoverable
4. **Earn ALGO** - Get paid for every API call

## 🤝 Need Help?

- **Documentation**: https://github.com/yourusername/algope
- **Issues**: https://github.com/yourusername/algope/issues
- **Discord**: Join our community (link)

---

**Happy Monetizing! 💰**

AlgoPe makes it easy to monetize any API with real blockchain micropayments.
