module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { ean, name, sites } = req.body;
  if (!ean) return res.status(400).json({ error: 'EAN manquant' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Clé API non configurée' });

  const siteList = sites && sites.length ? sites.join(', ') : 'Sephora FR, Notino, Marionnaud, Nocibé, Douglas, Flaconi, Fragrance.com, Amazon FR, Amazon DE, Amazon UK, Amazon US, parfumdreams, Feelunique, site officiel marque';

  const prompt = `Parfum EAN "${ean}"${name ? ` (${name})` : ''}. Cherche prix sur: ${siteList}. JSON uniquement sans markdown:
{"product_name":"nom complet","brand":"marque","volume_ml":75,"type":"Eau de Parfum","found":true,"prices":[{"site":"Sephora","country":"FR","currency":"EUR","price":69.90,"isOfficial":false,"url":"https://...","in_stock":true}],"notes":""}
Si inconnu: found:false, prices:[].`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 800,
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }],
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return res.status(502).json({ error: err.error?.message || 'Erreur API' });
    }

    const data = await response.json();
    const text = data.content.filter(b => b.type === 'text').map(b => b.text).join('');
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return res.status(502).json({ error: 'Réponse inattendue' });

    const result = JSON.parse(match[0]);
    if (result.prices) {
      result.prices = result.prices.map(p => ({
        ...p,
        priceEur: p.currency === 'GBP' ? p.price * 1.18 : p.currency === 'USD' ? p.price * 0.92 : p.price
      }));
    }
    return res.status(200).json(result);

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
