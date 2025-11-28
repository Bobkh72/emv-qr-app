// ---------------------------------------------------------
// FIX: Render TypeScript error for module "qrcode"
// ---------------------------------------------------------
import { useState } from "react";
import * as QRCode from "qrcode";
import "./App.css";


// -----------------------
// TCV GENERATOR
// -----------------------
function generateTcv(
  amount: string,
  currency: string,
  merchantAccount: string,
  useTimestamp: boolean = true
): string {
  const raw = useTimestamp
    ? `${amount}|${currency}|${merchantAccount}|${Date.now()}`
    : `${amount}|${currency}|${merchantAccount}`;

  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    hash = (hash * 31 + raw.charCodeAt(i)) % 1000000;
  }

  return hash.toString().padStart(6, "0");
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
  const [merchantAccount, setMerchantAccount] = useState("100000010000331");
  const [timestamp, setTimestamp] = useState("240712101550");
  const [tcv29, setTcv29] = useState("10000011");

  const [amount, setAmount] = useState("100.8");

  // Dropdown: USD / LBP
  const [currency, setCurrency] = useState("840");  // default USD

  const [tcvStatic, setTcvStatic] = useState("453999");
  const [tcvDynamic, setTcvDynamic] = useState("795679");

  const [payload, setPayload] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState("");

  // ----------------------------------------------------
  // BUILD EMV PAYLOAD
  // ----------------------------------------------------
  const buildEmvPayload = (): string => {

    const dyn = generateTcv(amount, currency, merchantAccount, true);
    setTcvDynamic(dyn);

    const stc = generateTcv(amount, currency, merchantAccount, false);
    setTcvStatic(stc);

    // EMV TAGS
    const tag00 = tlv("00", "01");
    const tag01 = tlv("01", "12");
    const tag02 = tlv("02", "EMV");

    const tag05 = tlv(
      "05",
      tlv("01", "CCM") + tlv("02", "MOF")
    );

    const tag29 = tlv(
      "29",
      tlv("00", merchantAccount) +
      tlv("01", timestamp) +
      tlv("05", tcv29)
    );

    const tag52 = tlv("52", "1434");
    const tag53 = tlv("53", currency);
    const tag54 = tlv("54", amount);
    const tag58 = tlv("58", "LB");
    const tag59 = tlv("59", "CCM Test Merchant");
    const tag60 = tlv("60", "BEIRUT");

    const tag62 = tlv(
      "62",
      tlv("02", dyn) + tlv("04", stc)
    );

    const withoutCrc =
      tag00 + tag01 + tag02 + tag05 + tag29 +
      tag52 + tag53 + tag54 + tag58 + tag59 + tag60 +
      tag62 + "6304";

    const crc = computeCrc16(withoutCrc);

    return withoutCrc + crc;
  };

  // ----------------------------------------------------
  // GENERATE QR
  // ----------------------------------------------------
  const handleGenerate = async () => {
    const finalPayload = buildEmvPayload();
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

          {/* Amount */}
          <label className="field-label">Amount</label>
          <input className="field-input"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />

          {/* Currency Dropdown */}
          <label className="field-label">Currency</label>
          <select
            className="field-input"
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
          >
            <option value="840">USD</option>
            <option value="422">LBP</option>
          </select>

          {/* Merchant Account */}
          <label className="field-label">Merchant Account (29.00)</label>
          <input className="field-input"
            value={merchantAccount}
            onChange={(e) => setMerchantAccount(e.target.value)}
          />

          {/* Timestamp */}
          <label className="field-label">Timestamp (29.01)</label>
          <input className="field-input"
            value={timestamp}
            onChange={(e) => setTimestamp(e.target.value)}
          />

          {/* TCV29 */}
          <label className="field-label">Terminal ID (29.05)</label>
          <input className="field-input"
            value={tcv29}
            onChange={(e) => setTcv29(e.target.value)}
          />

          {/* Static TCV (user may override) */}
          <label className="field-label">Static TCV (62.04)</label>
          <input className="field-input"
            value={tcvStatic}
            onChange={(e) => setTcvStatic(e.target.value)}
          />

          <button className="primary-btn" onClick={handleGenerate}>
            Generate QR
          </button>

          <label className="field-label">Dynamic TCV (62.02)</label>
          <input className="field-input" value={tcvDynamic} readOnly />
        </div>

        {/* RIGHT SIDE */}
        <div className="card">
          <h3 className="card-title">Generated Payload</h3>
          <div className="payload-box">
            <pre className="payload-text">{payload}</pre>
          </div>

          <div className="qr-preview">
            {qrDataUrl ? (
              <img className="qr-image" src={qrDataUrl} />
            ) : (
              <div className="qr-placeholder">QR will appear here</div>
            )}
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
