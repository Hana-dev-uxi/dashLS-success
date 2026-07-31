const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

function getFileExtension(filename) {
  if (!filename || !filename.includes('.')) return '.bin';
  return '.' + filename.split('.').pop();
}

async function uploadToSupabase(file, env) {
  const fileExt = getFileExtension(file.name);
  const fileName = `${Date.now()}_${Math.random().toString(36).substring(2, 8)}${fileExt}`;
  const uploadUrl = `${env.SUPABASE_URL}/storage/v1/object/student-docs/${fileName}`;

  const buffer = await file.arrayBuffer();

  const res = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'apikey': env.SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${env.SUPABASE_ANON_KEY}`,
      'Content-Type': file.type || 'application/octet-stream'
    },
    body: buffer
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Storage upload failed: ${errText}`);
  }
  return `${env.SUPABASE_URL}/storage/v1/object/public/student-docs/${fileName}`;
}

async function generateGroqSummary(studentName, notes, env) {
  if (!env.GROQ_API_KEY) return `Dossier soumis par ${studentName}.`;

  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'qwen/qwen3.6-27b',
        reasoning_effort: "none",
        messages: [
          { role: 'system', content: `Tu es un réducteur de texte ultra-factuel.
Ton rôle est de synthétiser UNIQUEMENT ce que le candidat a rédigé dans ses motivations.

RÈGLES STRICTES :
1. ZERO HALLUCINATION : N'invente ABSOLUMENT AUCUN détail (pas de diplôme, pas de parcours, pas de domaine d'études) qui n'est pas explicitement écrit dans la note.
2. FIAT JUSTITIA : Si la note est courte, ton résumé doit être très court (1 phrase max). Ne meuble pas.
3. PAS DE MÉTATEXTE : Pas de "Voici le résumé", "Le candidat explique que", etc. Donne direct la synthèse.` },
          { role: 'user', content: `Candidat: ${studentName}. Remarques/Motivations: ${notes} /no_think` }
        ]
      })
    });
    const data = await res.json();
    return data.choices?.[0]?.message?.content || `Dossier soumis par ${studentName}.`;
  } catch (e) {
    return `Candidat: ${studentName}`;
  }
}

async function sendEmail(to, subject, html, env) {
  if (!env.RESEND_API_KEY) return;
  return fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.RESEND_API_KEY}`,
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

export async function onRequest(context) {
  const { request, env } = context;

  // 1. Preflight CORS
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // 2. Enforce POST
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { 
      status: 405, 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });
  }

  try {
    const formData = await request.formData();
    const name = formData.get('name');
    const email = formData.get('email');
    const phone = formData.get('phone');
    const notes = formData.get('notes');
    const files = formData.getAll('documents');

    const uploadedDocUrls = [];
    for (const file of files) {
      if (file && typeof file === 'object' && file.name && file.size > 0) {
        const publicUrl = await uploadToSupabase(file, env);
        uploadedDocUrls.push(publicUrl);
      }
    }

    const aiSummary = await generateGroqSummary(name, notes || '', env);

    const dbRes = await fetch(`${env.SUPABASE_URL}/rest/v1/applications`, {
      method: 'POST',
      headers: {
        'apikey': env.SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${env.SUPABASE_ANON_KEY}`,
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
    if (!dbRes.ok) {
      return new Response(JSON.stringify({ error: `Database error: ${data.message || JSON.stringify(data)}` }), { 
        status: 400, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    const appRecord = data[0];
    if (!appRecord) {
      throw new Error("Database inserted row but returned no record.");
    }

    const urlObj = new URL(request.url);
    const trackingToken = appRecord.access_token || appRecord.id;
    const trackingUrl = `${urlObj.origin}/?token=${trackingToken}`;

    await sendEmail(email, "Confirmation de votre dossier de candidature", 
      `<p>Bonjour ${name},</p><p>Votre candidature a bien été transmise.</p><p>Vous pouvez suivre son avancement via ce lien : <a href="${trackingUrl}">${trackingUrl}</a></p>`,
      env
    );

    return new Response(JSON.stringify({ success: true, token: trackingToken }), { 
      status: 200, 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { 
      status: 500, 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });
  }
}
