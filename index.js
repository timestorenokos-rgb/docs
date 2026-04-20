const express = require('express');
const crypto = require("crypto");
const QRCode = require('qrcode');
const { ImageUploadService } = require('node-upload-images');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const VALID_APIKEYS = ['Time'];

class OrderKuota {
  static API_URL = 'https://app.orderkuota.com/api/v2';
  static HOST = 'app.orderkuota.com';
  static USER_AGENT = 'okhttp/4.12.0';
  static APP_VERSION_NAME = '25.09.18';
  static APP_VERSION_CODE = '250918';
  static APP_REG_ID = 'cdzXkBynRECkAODZEHwkeV:APA91bHRyLlgNSlpVrC4Yv3xBgRRaePSaCYruHnNwrEK8_pX3kzitxzi0CxIDFc2oztCwcw7-zPgwE-6v_-rJCJdTX8qE_ADiSnWHNeZ5O7_BIlgS_1N8tw';
  static PHONE_MODEL = '23124RA7EO';
  static PHONE_UUID = 'cdzXkBynRECkAODZEHwkeV';
  static PHONE_ANDROID_VERSION = '15';

  constructor(username = null, authToken = null) {
    this.username = username;
    this.authToken = authToken;
  }

  buildHeaders() {
    return {
      'Host': OrderKuota.HOST,
      'User-Agent': OrderKuota.USER_AGENT,
      'Content-Type': 'application/x-www-form-urlencoded',
      'accept-encoding': 'gzip',
      'X-Forwarded-For': "50.50.50.120"   
    };
  }

  async request(method, url, body = null) {
    try {
      const res = await fetch(url, {
        method,
        headers: this.buildHeaders(),
        body: body ? body.toString() : null,
      });
      const contentType = res.headers.get("content-type");
      return contentType && contentType.includes("application/json") ? await res.json() : await res.text();
    } catch (err) {
      return { error: err.message };
    }
  }

  async loginRequest(username, password) {
    const payload = new URLSearchParams({
      username, password, request_time: Date.now(),
      app_reg_id: OrderKuota.APP_REG_ID, phone_android_version: OrderKuota.PHONE_ANDROID_VERSION,
      app_version_code: OrderKuota.APP_VERSION_CODE, phone_uuid: OrderKuota.PHONE_UUID
    });
    return await this.request('POST', `${OrderKuota.API_URL}/login`, payload);
  }

  async getAuthToken(username, otp) {
    return await this.loginRequest(username, otp);
  }

  async getTransactionQris(type = '') {
    const userId = this.authToken ? this.authToken.split(':')[0] : null;
    const payload = new URLSearchParams({
      request_time: Date.now(), app_reg_id: OrderKuota.APP_REG_ID,
      phone_android_version: OrderKuota.PHONE_ANDROID_VERSION, app_version_code: OrderKuota.APP_VERSION_CODE,
      phone_uuid: OrderKuota.PHONE_UUID, auth_username: this.username, auth_token: this.authToken,
      'requests[qris_history][jenis]': type, 'requests[qris_history][page]': '1',
      'requests[0]': 'account', app_version_name: OrderKuota.APP_VERSION_NAME,
      ui_mode: 'light', phone_model: OrderKuota.PHONE_MODEL
    });
    const endpoint = userId ? `${OrderKuota.API_URL}/qris/mutasi/${userId}` : `${OrderKuota.API_URL}/get`;
    return await this.request('POST', endpoint, payload);
  }

  async generateQr(amount = '') {
    const payload = new URLSearchParams({
      request_time: Date.now(), app_reg_id: OrderKuota.APP_REG_ID,
      phone_android_version: OrderKuota.PHONE_ANDROID_VERSION, app_version_code: OrderKuota.APP_VERSION_CODE,
      phone_uuid: OrderKuota.PHONE_UUID, auth_username: this.username, auth_token: this.authToken,
      'requests[qris_merchant_terms][jumlah]': amount, 'requests[0]': 'qris_merchant_terms',
      app_version_name: OrderKuota.APP_VERSION_NAME, phone_model: OrderKuota.PHONE_MODEL
    });
    const res = await this.request('POST', `${OrderKuota.API_URL}/get`, payload);
    return (res.success && res.qris_merchant_terms?.results) ? res.qris_merchant_terms.results : res;
  }
}

function convertCRC16(str) {
  let crc = 0xFFFF;
  for (let c = 0; c < str.length; c++) {
    crc ^= str.charCodeAt(c) << 8;
    for (let i = 0; i < 8; i++) {
      crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1;
    }
  }
  return ("000" + (crc & 0xFFFF).toString(16).toUpperCase()).slice(-4);
}

async function createQRIS(amount, qrisData) {
  qrisData = qrisData.slice(0, -4);
  const step2 = qrisData.replace("010211", "010212").split("5802ID");
  let uang = "54" + ("0" + amount.toString().length).slice(-2) + amount + "5802ID";
  const final = step2[0] + uang + step2[1];
  const result = final + convertCRC16(final);

  const buffer = await QRCode.toBuffer(result);
  const service = new ImageUploadService('pixhost.to');
  const { directLink } = await service.uploadFromBinary(buffer, 'Time.png');

  return {
    idtransaksi: `TIME-${crypto.randomBytes(2).toString('hex').toUpperCase()}`,
    jumlah: amount,
    imageqris: { url: directLink }
  };
}

app.get('/', async (req, res) => {
  const { action, apikey, username, password, otp, token, amount } = req.query;

  if (!action) {
  return res.sendFile(__dirname + '/index.html');
}

  if (!VALID_APIKEYS.includes(apikey)) {
    return res.status(401).json({ status: false, error: 'Apikey invalid' });
  }

  const ok = new OrderKuota(username, token);
  try {
    switch (action) {
      case 'getotp': {
        if (!username || !password) return res.status(400).json({ status: false, error: 'Missing username/password' });
        const otpReq = await ok.loginRequest(username, password);
        res.json({ status: true, result: otpReq.results });
        break;
      }

      case 'gettoken': {
        if (!username || !otp) return res.status(400).json({ status: false, error: 'Missing username/otp' });
        const tokenReq = await ok.getAuthToken(username, otp);
        res.json({ status: true, result: tokenReq.results });
        break;
      }

      case 'mutasiqr': {
        if (!username || !token) return res.status(400).json({ status: false, error: 'Missing username/token' });
        const mutasiReq = await ok.getTransactionQris();
        res.json({ status: true, result: mutasiReq.qris_history?.results || mutasiReq });
        break;
      }

      case 'createpayment': {
        if (!username || !token || !amount) return res.status(400).json({ status: false, error: 'Missing username/token/amount' });
        const qrcodeResp = await ok.generateQr(amount);
        if (!qrcodeResp.qris_data) return res.status(400).json({ status: false, error: "QRIS generation failed", raw: qrcodeResp });
        const qrisResult = await createQRIS(amount, qrcodeResp.qris_data);
        res.json({ status: true, result: qrisResult });
        break;
      }

      default:
        res.status(404).json({ status: false, error: 'Action not valid' });
    }
  } catch (error) {
    res.status(500).json({ status: false, error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});

module.exports = app;
