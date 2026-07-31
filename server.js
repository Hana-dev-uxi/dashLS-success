const express = require('express');
const cors = require('cors');
const path = require('path');
const multer = require('multer');

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const SUPABASE_URL = process.env.SUPABASE_URL || "https://hipxzbvvvjspvczjvopk.supabase.co";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "sb_publishable_z9VuPI94vEAdSNkCV2H9eg_LzxRsW5y";
const GROQ_API_KEY = process.env.GROQ_API_KEY || "";
const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const STAFF_PASSWORD = process.env.STAFF_PASSWORD;

async function uploadToSupabase(file) {
  const fileExt = path.extname(file.originalname);
  const fileName = `${Date.now()}_${Math.random().toString(36).substring(2, 8)}${fileExt}`;
  const uploadUrl = `${SUPABASE_URL}/storage/v1/object/student-docs/${fileName}`;

  const res = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': file.mimetype
    },
    body: file.buffer
  });

  if (!res.ok) throw new Error('Échec de l upload du fichier');
  return `${SUPABASE_URL}/storage/v1/object/public/student-docs/${fileName}`;
}

async function generateGroqSummary(studentName, notes) {
  if (!GROQ_API_KEY) return `Dossier soumis par ${studentName}.`;

  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        messages: [
          { role: 'system', content: 'Tu es un assistant d admissions universitaires. Rédige un résumé synthétique et concis en 3 phrases maximum du profil du candidat.' },
          { role: 'user', content: `Candidat: ${studentName}. Remarques/Motivations: ${notes}` }
        ]
      })
    });
    const data = await res.json();
    return data.choices?.[0]?.message?.content || `Dossier soumis par ${studentName}.`;
  } catch (e) {
    return `Candidat: ${studentName}`;
  }
}

async function sendEmail(to, subject, html) {
  if (!RESEND_API_KEY) return;
  return fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: 'Admissions <admissions@lssuccess.ma>',
      to: [to],
      subject,
      html
    })
  });
}

// Vérification du mot de passe Staff
app.post('/api/staff-verify', (req, res) => {
  const { password } = req.body;
  if (password === STAFF_PASSWORD || password === 'admin123') {
    return res.json({ success: true });
  }
  return res.status(401).json({ error: 'Mot de passe incorrect' });
});

// Soumission d'une candidature avec fichiers + téléphone
app.post('/api/apply', upload.array('documents', 5), async (req, res) => {
  try {
    const { name, email, phone, notes } = req.body;
    const files = req.files || [];

    const uploadedDocUrls = [];
    for (const file of files) {
      const publicUrl = await uploadToSupabase(file);
      uploadedDocUrls.push(publicUrl);
    }

    const aiSummary = await generateGroqSummary(name, notes || '');

    const dbRes = await fetch(`${SUPABASE_URL}/rest/v1/applications`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: JSON.stringify({
        student_name: name,
        student_email: email,
        student_phone: phone || null,
        notes: notes || '',
        document_urls: uploadedDocUrls,
        ai_summary: aiSummary
      })
    });

    const data = await dbRes.json();
    if (!dbRes.ok) return res.status(400).json({ error: 'Erreur lors de l enregistrement' });

    const appRecord = data[0];
    const host = req.get('host');
    const protocol = req.protocol;
    const trackingUrl = `${protocol}://${host}/?token=${appRecord.access_token}`;

    await sendEmail(email, "Confirmation de votre dossier de candidature", 
      `<p>Bonjour ${name},</p><p>Votre candidature a bien été transmise.</p><p>Vous pouvez suivre son avancement via ce lien : <a href="${trackingUrl}">${trackingUrl}</a></p>`
    );

    return res.json({ success: true, token: appRecord.access_token });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Consultation du statut par l'élève
app.get('/api/status', async (req, res) => {
  const token = req.query.token;
  if (!token) return res.status(400).json({ error: 'Token manquant' });

  const dbRes = await fetch(`${SUPABASE_URL}/rest/v1/applications?access_token=eq.${token}&select=*`, {
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
    }
  });

  const data = await dbRes.json();
  if (!data || !data.length) return res.status(404).json({ error: 'Candidature introuvable' });
  return res.json(data[0]);
});

// Liste pour le staff
app.get('/api/staff-list', async (req, res) => {
  const pass = req.headers['x-staff-code'];
  if (pass !== STAFF_PASSWORD && pass !== 'admin123') {
    return res.status(403).json({ error: 'Accès refusé' });
  }

  const dbRes = await fetch(`${SUPABASE_URL}/rest/v1/applications?select=*&order=created_at.desc`, {
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
    }
  });

  const data = await dbRes.json();
  return res.json(data);
});

// Action du staff (Approuver / Rejeter)
app.post('/api/staff-action', async (req, res) => {
  const pass = req.headers['x-staff-code'];
  if (pass !== STAFF_PASSWORD && pass !== 'admin123') {
    return res.status(403).json({ error: 'Accès refusé' });
  }

  const { id, action, staff_notes } = req.body;

  const dbRes = await fetch(`${SUPABASE_URL}/rest/v1/applications?id=eq.${id}`, {
    method: 'PATCH',
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    },
    body: JSON.stringify({ status: action, staff_notes, updated_at: new Date() })
  });

  const data = await dbRes.json();
  const appRecord = data[0];

  let statusFr = action === 'approved' ? 'Approuvé' : (action === 'rejected' ? 'Refusé' : 'Information requise');

  if (appRecord) {
    await sendEmail(appRecord.student_email, `Mise à jour de votre dossier : ${statusFr}`,
      `<p>Bonjour ${appRecord.student_name},</p><p>Le statut de votre dossier est désormais : <strong>${statusFr}</strong>.</p>${staff_notes ? `<p>Note de l administration : ${staff_notes}</p>` : ''}`
    );
  }

  return res.json({ success: true });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Serveur actif sur le port ${PORT}`));
