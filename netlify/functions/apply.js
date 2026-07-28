import path from 'path';

const SUPABASE_URL = process.env.SUPABASE_URL || "https://hipxzbvvvjspvczjvopk.supabase.co";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "sb_publishable_z9VuPI94vEAdSNkCV2H9eg_LzxRsW5y";
const GROQ_API_KEY = process.env.GROQ_API_KEY || "";
const RESEND_API_KEY = process.env.RESEND_API_KEY || "";

async function uploadToSupabase(file) {
  const fileExt = path.extname(file.name) || '.bin';
  const fileName = `${Date.now()}_${Math.random().toString(36).substring(2, 8)}${fileExt}`;
  const uploadUrl = `${SUPABASE_URL}/storage/v1/object/student-docs/${fileName}`;

  const buffer = await file.arrayBuffer();

  const res = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': file.type || 'application/octet-stream'
    },
    body: buffer
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

export default async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  try {
    const formData = await req.formData();
    const name = formData.get('name');
    const email = formData.get('email');
    const phone = formData.get('phone');
    const notes = formData.get('notes');
    const files = formData.getAll('documents');

    const uploadedDocUrls = [];
    for (const file of files) {
      if (file && typeof file === 'object' && file.name) {
        const publicUrl = await uploadToSupabase(file);
        uploadedDocUrls.push(publicUrl);
      }
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
    if (!dbRes.ok) return new Response(JSON.stringify({ error: 'Erreur lors de l enregistrement' }), { status: 400 });

    const appRecord = data[0];
    const urlObj = new URL(req.url);
    const trackingUrl = `${urlObj.origin}/?token=${appRecord.access_token}`;

    await sendEmail(email, "Confirmation de votre dossier de candidature", 
      `<p>Bonjour ${name},</p><p>Votre candidature a bien été transmise.</p><p>Vous pouvez suivre son avancement via ce lien : <a href="${trackingUrl}">${trackingUrl}</a></p>`
    );

    return new Response(JSON.stringify({ success: true, token: appRecord.access_token }), { status: 200 });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};