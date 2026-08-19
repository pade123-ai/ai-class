const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const QRCode = require('qrcode');
const path = require('path');

const app = express();
app.use(express.json());

// ---------------------------------------------------------------------------
// 1. DATABASE SETUP (SQLite embedded file-based or in-memory)
// ---------------------------------------------------------------------------
const db = new sqlite3.Database(':memory:'); // Use 'events.db' to persist to disk

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS registrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL,
      email TEXT NOT NULL,
      qr_code_text TEXT UNIQUE NOT NULL,
      checked_in INTEGER DEFAULT 0,
      checked_in_at TEXT
    )
  `);
});

// ---------------------------------------------------------------------------
// 2. BACKEND API ENDPOINTS
// ---------------------------------------------------------------------------

// API: Register Attendee
app.post('/api/register', async (req, res) => {
  const { full_name, email } = req.body;
  if (!full_name || !email) {
    return res.status(400).json({ error: 'Name and Email are required.' });
  }

  const qrCodeText = `REG-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

  try {
    const qrCodeUrl = await QRCode.toDataURL(qrCodeText);

    db.run(
      `INSERT INTO registrations (full_name, email, qr_code_text) VALUES (?, ?, ?)`,
      [full_name, email, qrCodeText],
      function (err) {
        if (err) return res.status(500).json({ error: err.message });

        res.status(201).json({
          success: true,
          attendee: { id: this.lastID, full_name, email, qr_code_text: qrCodeText },
          qrCodeUrl,
        });
      }
    );
  } catch (err) {
    res.status(500).json({ error: 'QR Code generation failed.' });
  }
});

// API: Check-In Attendee
app.post('/api/checkin', (req, res) => {
  const { qr_code_text } = req.body;

  db.get(
    `SELECT * FROM registrations WHERE qr_code_text = ?`,
    [qr_code_text],
    (err, attendee) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!attendee) {
        return res.status(404).json({ success: false, message: 'Invalid Ticket' });
      }

      if (attendee.checked_in) {
        return res.status(400).json({
          success: false,
          message: `Already checked in at ${attendee.checked_in_at}`,
          attendee,
        });
      }

      const timestamp = new Date().toLocaleTimeString();
      db.run(
        `UPDATE registrations SET checked_in = 1, checked_in_at = ? WHERE id = ?`,
        [timestamp, attendee.id],
        (updateErr) => {
          if (updateErr) return res.status(500).json({ error: updateErr.message });

          res.json({
            success: true,
            message: `Welcome, ${attendee.full_name}! Check-in successful.`,
            attendee: { ...attendee, checked_in: 1, checked_in_at: timestamp },
          });
        }
      );
    }
  );
});

// ---------------------------------------------------------------------------
// 3. FRONTEND USER INTERFACE (HTML / CSS / JS)
// ---------------------------------------------------------------------------
app.get('/', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Event Platform</title>
  <script src="https://unpkg.com/html5-qrcode"></script>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f4f6f8; margin: 0; padding: 20px; }
    .container { max-width: 800px; margin: 0 auto; display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
    @media (max-width: 768px) { .container { grid-template-columns: 1fr; } }
    .card { background: white; padding: 24px; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.05); }
    h2 { margin-top: 0; color: #111827; border-bottom: 2px solid #f3f4f6; padding-bottom: 10px; }
    input { width: 100%; padding: 10px; margin: 8px 0 16px; border: 1px solid #d1d5db; border-radius: 6px; box-sizing: border-box; }
    button { width: 100%; background: #2563eb; color: white; border: none; padding: 12px; border-radius: 6px; font-weight: bold; cursor: pointer; }
    button:hover { background: #1d4ed8; }
    #ticket { text-align: center; border: 2px dashed #2563eb; padding: 16px; border-radius: 8px; background: #eff6ff; }
    #ticket img { width: 180px; height: 180px; }
    #reader { width: 100%; border-radius: 8px; overflow: hidden; }
    .status { margin-top: 15px; padding: 12px; border-radius: 6px; font-size: 14px; text-align: center; font-weight: bold; }
    .success { background: #dcfce7; color: #166534; border: 1px solid #bbf7d0; }
    .error { background: #fee2e2; color: #991b1b; border: 1px solid #fecaca; }
  </style>
</head>
<body>

  <div class="container">
    <!-- Attendee Registration Portal -->
    <div class="card">
      <h2>Attendee Registration</h2>
      <form id="regForm">
        <label>Full Name</label>
        <input type="text" id="full_name" placeholder="Jane Doe" required />
        <label>Email Address</label>
        <input type="email" id="email" placeholder="jane@example.com" required />
        <button type="submit">Get Event Ticket</button>
      </form>

      <div id="ticket" style="display: none; margin-top: 20px;">
        <h3 id="ticketName" style="margin: 0 0 8px 0;"></h3>
        <img id="qrImage" src="" alt="QR Pass" />
        <p style="font-size: 12px; color: #4b5563; margin-top: 8px;">Show this pass at entry</p>
      </div>
    </div>

    <!-- Host Scanner Station -->
    <div class="card">
      <h2>Host Check-In Station</h2>
      <div id="reader"></div>
      <div id="statusBox" style="display: none;" class="status"></div>
    </div>
  </div>

  <script>
    // Handle Registration Submit
    document.getElementById('regForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const full_name = document.getElementById('full_name').value;
      const email = document.getElementById('email').value;

      const res = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ full_name, email })
      });

      const data = await res.json();
      if (data.success) {
        document.getElementById('ticketName').innerText = data.attendee.full_name;
        document.getElementById('qrImage').src = data.qrCodeUrl;
        document.getElementById('ticket').style.display = 'block';
      }
    });

    // Initialize Camera Scanner
    const statusBox = document.getElementById('statusBox');
    let isProcessing = false;

    function onScanSuccess(decodedText) {
      if (isProcessing) return;
      isProcessing = true;

      fetch('/api/checkin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ qr_code_text: decodedText })
      })
      .then(res => res.json())
      .then(data => {
        statusBox.style.display = 'block';
        statusBox.className = 'status ' + (data.success ? 'success' : 'error');
        statusBox.innerText = data.message;
        
        // Cooldown before scanning next ticket
        setTimeout(() => { 
          isProcessing = false; 
          statusBox.style.display = 'none';
        }, 3000);
      })
      .catch(() => { isProcessing = false; });
    }

    const html5QrcodeScanner = new Html5QrcodeScanner("reader", { fps: 10, qrbox: 200 });
    html5QrcodeScanner.render(onScanSuccess);
  </script>
</body>
</html>
  `);
});

// ---------------------------------------------------------------------------
// 4. START SERVER
// ---------------------------------------------------------------------------
const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Server running live on http://localhost:${PORT}`);
});