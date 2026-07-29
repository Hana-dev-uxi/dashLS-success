const SUPABASE_URL = process.env.SUPABASE_URL || "https://hipxzbvvvjspvczjvopk.supabase.co";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
if (!SUPABASE_ANON_KEY) throw new Error("Missing SUPABASE_ANON_KEY");

export default async (req) => {
  const url = new URL(req.url);
  const token = url.searchParams.get('token');
  if (!token) {
    return new Response(JSON.stringify({ error: 'Token manquant' }), { status: 400 });
  }

  const dbRes = await fetch(`${SUPABASE_URL}/rest/v1/applications?access_token=eq.${token}&select=*`, {
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
    }
  });

  const data = await dbRes.json();
  if (!data || !data.length) {
    return new Response(JSON.stringify({ error: 'Candidature introuvable' }), { status: 404 });
  }

  return new Response(JSON.stringify(data[0]), { status: 200 });
};
