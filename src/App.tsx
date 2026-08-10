// ---------------------------------------------------------
// FIX: Render TypeScript error for module "qrcode"
// ---------------------------------------------------------
import { useState } from "react";
import * as QRCode from "qrcode";
import "./App.css";

// -----------------------
// UTC Timestamp: yyyyMMddHHmmss (matches Java/VB logic)
// -----------------------
function utcTimestampYYYYMMDDHHMMSS(): string {
  const d = new Date();
  const pad = (n: number) => n.toString().padStart(2, "0");
  return (
    d.getUTCFullYear().toString() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds())
  );
}

// -----------------------
// TCV GENERATOR (matches VB.NET / Java)
// Input = amount + currency + deviceId + transactionId [+ timestamp(yyyyMMddHHmmss UTC)]
// Steps:
// 1) SHA-256(UTF-8)
// 2) Take first 8 bytes as LITTLE-ENDIAN UInt64
// 3) UInt64 mod 1,000,000
// 4) return 6-digit zero padded
// -----------------------
async function generateTcv(
  amount: string,
  currency: string,
  deviceId: string,
  transactionId: string,
  isDynamic: boolean = true,
  fixedTimestamp?: string // OPTIONAL: for cross-system comparison
): Promise<string> {
  const timestamp = isDynamic ? (fixedTimestamp ?? utcTimestampYYYYMMDDHHMMSS()) : "";

  // IMPORTANT: exact same concatenation as VB/Java (NO separators)
  const input = amount + currency + deviceId + transactionId + timestamp;

  const encoder = new TextEncoder();
  const data = encoder.encode(input);

  // Web Crypto API SHA-256
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashBytes = new Uint8Array(hashBuffer);

  // First 8 bytes as LITTLE-ENDIAN UInt64
  let u64 =
    BigInt(hashBytes[0]) |
    (BigInt(hashBytes[1]) << 8n) |
    (BigInt(hashBytes[2]) << 16n) |
    (BigInt(hashBytes[3]) << 24n) |
    (BigInt(hashBytes[4]) << 32n) |
    (BigInt(hashBytes[5]) << 40n) |
    (BigInt(hashBytes[6]) << 48n) |
    (BigInt(hashBytes[7]) << 56n);

  const tcv = u64 % 1_000_000n;
  return tcv.toString().padStart(6, "0");
}

// -----------------------
// 7-DIGIT TCV + ACQUIRER ID ENCODER
// Spec: MOF POS Integration Specification.txt
// -----------------------
function encodeCombinedTcv(tcv: number, key: number): string {
    if (tcv < 0 || tcv > 999999) {
        throw new Error("Number must be 6 digits");
    }

    if (key < 0 || key > 9) {
        throw new Error("Key must be 0-9");
    }

    const numStr: string = tcv.toString().padStart(6, '0');

    const digits: number[] = new Array(6);

    // Convert number to digit array
    for (let i = 0; i < 6; i++) {
        digits[i] = Number(numStr[i]);
    }

    // Encode into 7 digits with key diffusion
    const combined: number[] = new Array(7);

    combined[0] = (digits[0] + key) % 10;

    for (let i = 1; i < 6; i++) {
        combined[i] = (digits[i] + key + combined[i - 1]) % 10;
    }

    combined[6] = (key + combined[5]) % 10; // hides key

    return combined.join('');
}

// -----------------------
// CRC FUNCTION
// -----------------------
const computeCrc16 = (data: string): string => {
  let crc = 0xffff;
  const poly = 0x1021;

  for (let i = 0; i < data.length; i++) {
    crc ^= data.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      crc = crc & 0x8000 ? ((crc << 1) & 0xffff) ^ poly : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
};

// -----------------------
// TLV Helper
// -----------------------
const tlv = (id: string, value: string): string => {
  const len = value.length.toString().padStart(2, "0");
  return `${id}${len}${value}`;
};

function App() {
  // -----------------------------
  // USER-EDITABLE FIELDS (NEW)
  // -----------------------------
  const [merchantAccount, setmerchantAccount] = useState("100000010000331");

  // Default timestamp now matches TCV dynamic timestamp format (UTC yyyyMMddHHmmss)
  const [timestamp, setTimestamp] = useState(utcTimestampYYYYMMDDHHMMSS());

  
  const [deviceId, setDeviceId] = useState("123456");
//const [terminalId, setterminalId] = useState("10000011");
const [terminalId, setterminalId] = useState("10000011");
  const [amount, setAmount] = useState("3000.00");

  // Dropdown: USD / LBP
  const [currency, setCurrency] = useState("422"); // default LBP

  const [tcvStatic, setTcvStatic] = useState("");
  const [tcvDynamic, setTcvDynamic] = useState("795679");
  const [acquirerId, setAcquirerId] = useState("0");
  const [encodedWayDesc, setEncodedWayDesc] = useState("");
  const [trxid, settrxid] = useState("123456789123");
  const [binType, setBinType] = useState("L");

  const [payload, setPayload] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState("");

  // ----------------------------------------------------
  // BUILD EMV PAYLOAD (async because TCV uses SHA-256)
  // ----------------------------------------------------
  const buildEmvPayload = async (): Promise<string> => {
    // IMPORTANT:
    // Use the SAME timestamp field for dynamic TCV to match backend (Java/VB) if you pass it along.
    const dyn = await generateTcv(amount, currency, deviceId, trxid, true, timestamp);
    setTcvDynamic(dyn);

    const stc = await generateTcv(amount, currency, deviceId, trxid, false);
    setTcvStatic(stc);
    const wayDesc = encodeCombinedTcv(Number(stc), Number(acquirerId));
    setEncodedWayDesc(wayDesc);

    // EMV TAGS
    const tag00 = tlv("00", "01");
    const tag01 = tlv("01", "12");
    const tag02 = tlv("02", "EMV");

    const tag05 = tlv("05", tlv("01", "MOF") + tlv("02", "CCM"));
	  const tag29 = tlv("29", tlv("00", merchantAccount) + tlv("01", timestamp));
    const tag42 = tlv("42", binType);
    const tag52 = tlv("52", "1434");
    const tag53 = tlv("53", currency);
    const tag54 = tlv("54", amount);
    const tag58 = tlv("58", "LB");
    const tag59 = tlv("59", "Test Merchant");
    const tag60 = tlv("60", "BEIRUT");

    // 62.02 carries the 7-digit combined value described in the MOF spec.
    const tag62 = tlv(
      "62",
      tlv("02", wayDesc) +
        tlv("03", merchantAccount) +
        tlv("05", deviceId) +
        tlv("07", terminalId) +
        tlv("10", trxid)
    );

    const withoutCrc =
      tag00 +
      tag01 +
      tag02 +
      tag05 +
      tag29 +
      tag42 +
      tag52 +
      tag53 +
      tag54 +
      tag58 +
      tag59 +
      tag60 +
      tag62 +
      "6304";

    const crc = computeCrc16(withoutCrc);
    return withoutCrc + crc;
  };

  // ----------------------------------------------------
  // GENERATE QR
  // ----------------------------------------------------
  const handleGenerate = async () => {
    const finalPayload = await buildEmvPayload();
    setPayload(finalPayload);

    try {
      const url = await QRCode.toDataURL(finalPayload);
      setQrDataUrl(url);
    } catch {
      setQrDataUrl("");
    }
  };

  return (
    <div className="app-root">
      <h1 className="app-title">EMV QR Generator</h1>

      <div className="app-layout">
        {/* LEFT SIDE */}
        <div className="card">
          <h3 className="card-title">Transaction Inputs</h3>

          {/* Bin Type Dropdown */}
          <label className="field-label">Bin Type 42</label>
          <select className="field-input" value={binType} onChange={(e) => setBinType(e.target.value)}>
            <option value="L">Local</option>
            <option value="I">International</option>
          </select>

          {/* Amount */}
          <label className="field-label">Amount 54</label>
          <input className="field-input" value={amount} onChange={(e) => setAmount(e.target.value)} />


          {/* Currency Dropdown */}
          <label className="field-label">Currency 53</label>
          <select className="field-input" value={currency} onChange={(e) => setCurrency(e.target.value)}>
            <option value="840">USD</option>
            <option value="422">LBP</option>
          </select>

          {/* Transaction ID */}
          <label className="field-label">Transaction ID (62.10)</label>
          <input className="field-input" value={trxid} onChange={(e) => settrxid(e.target.value)} />

          {/* Device ID */}
          <label className="field-label">Device ID (62.05)</label>
          <input className="field-input" value={deviceId} onChange={(e) => setDeviceId(e.target.value)} />

          <label className="field-label">Acquirer ID</label>
          <select className="field-input" value={acquirerId} onChange={(e) => setAcquirerId(e.target.value)}>
            <option value="0">0</option>
            <option value="1">1</option>
            <option value="2">2</option>
            <option value="3">3</option>
            <option value="4">4</option>
            <option value="5">5</option>
            <option value="6">6</option>
            <option value="7">7</option>
            <option value="8">8</option>
            <option value="9">9</option>
          </select>

          {/* Merchant Account */}
          <label className="field-label">Merchant ID (62.03 & 29.00)</label>
          <input className="field-input" value={merchantAccount} onChange={(e) => setmerchantAccount(e.target.value)} />

          {/* Timestamp */}
          <label className="field-label">Timestamp (29.01) [UTC yyyyMMddHHmmss]</label>
          <input className="field-input" value={timestamp} onChange={(e) => setTimestamp(e.target.value)} />

          {/* terminalId */}
          <label className="field-label">Terminal ID(62.07)</label>
          <input className="field-input" value={terminalId} onChange={(e) => setterminalId(e.target.value)} />

          <button className="primary-btn" onClick={handleGenerate}>
            Generate QR
          </button>

          {/* Static TCV */}
          <label className="field-label">Static TCV</label>
          <input className="field-input" value={tcvStatic} readOnly />

          <label className="field-label">Dynamic TCV</label>
          <input className="field-input" value={tcvDynamic} readOnly />

          <label className="field-label">Way Desc / Encoded TCV (62.02)</label>
          <input className="field-input" value={encodedWayDesc} readOnly />
        </div>

        {/* RIGHT SIDE */}
        <div className="card">
          <h3 className="card-title">Generated Payload</h3>
          <div className="payload-box">
            <pre className="payload-text">{payload}</pre>
          </div>

          <div className="qr-preview">
            {qrDataUrl ? <img className="qr-image" src={qrDataUrl} /> : <div className="qr-placeholder">QR will appear here</div>}
          </div>

          {qrDataUrl && (
            <a className="secondary-btn" href={qrDataUrl} download="emv_qr.png">
              Download QR
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
