module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { ean, name } = req.body;
  if (!ean) return res.status(400).json({ error: 'EAN manquant' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Clé API non configurée' });

  const prompt = `Recherche le parfum EAN "${ean}"${name ? ` ou "${name}"` : ''} sur internet. Trouve son nom, sa marque, et ses prix sur un maximum de sites e-commerce dans le monde.

Réponds UNIQUEMENT avec ce JSON minifié sur UNE SEULE LIGNE, sans retour à la ligne, sans markdown :
{"product_name":"nom","brand":"marque","volume_ml":75,"type":"Eau de Parfum","found":true,"prices":[{"site":"Notino","country":"FR","currency":"EUR","price":69.90,"isOfficial":false,"url":"https://notino.fr/...","in_stock":true}],"notes":""}

Règles strictes :
- JSON sur une seule ligne
- Maximum 15 sites
- URLs courtes (domaine + chemin court seulement)
- Pas de caractères spéciaux dans les valeurs
- Si introuvable : {"found":false,"prices":[]}`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 1500,
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 8 }],
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return res.status(502).json({ error: err.error?.message || 'Erreur API' });
    }

    const data = await response.json();
    const text = data.content.filter(b => b.type === 'text').map(b => b.text).join('');

    // Nettoyage robuste du JSON
    let jsonStr = text.replace(/```json|```/g, '').trim();
    
    // Cherche le JSON même s'il y a du texte autour
    const match = jsonStr.match(/\{.*\}/s);
    if (!match) return res.status(502).json({ error: 'Réponse inattendue du modèle' });

    jsonStr = match[0];

    // Nettoyage des problèmes courants
    jsonStr = jsonStr
      .replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ') // caractères de contrôle
      .replace(/,\s*}/g, '}')   // virgule avant }
      .replace(/,\s*]/g, ']');  // virgule avant ]

    let result;
    try {
      result = JSON.parse(jsonStr);
    } catch(parseErr) {
      // Tentative de récupération : extrait juste les données clés
      const productName = text.match(/"product_name"\s*:\s*"([^"]+)"/)?.[1] || 'Inconnu';
      const brand = text.match(/"brand"\s*:\s*"([^"]+)"/)?.[1] || '';
      const found = text.includes('"found":true');
      
      // Extrait les prix individuellement
      const prices = [];
      const priceRegex = /"site"\s*:\s*"([^"]+)"[^}]*"country"\s*:\s*"([^"]+)"[^}]*"currency"\s*:\s*"([^"]+)"[^}]*"price"\s*:\s*([\d.]+)/g;
      let m;
      while((m = priceRegex.exec(text)) !== null) {
        prices.push({
          site: m[1], country: m[2], currency: m[3], price: parseFloat(m[4]),
          isOfficial: false, url: '', in_stock: true
        });
      }
      result = { product_name: productName, brand, found, prices };
    }

    if (result.prices) {
      result.prices = result.prices.map(p => ({
        ...p,
        price: parseFloat(p.price) || 0,
        priceEur: p.currency === 'GBP' ? (parseFloat(p.price)||0) * 1.18 
                : p.currency === 'USD' ? (parseFloat(p.price)||0) * 0.92 
                : parseFloat(p.price) || 0
      }));
    }

    return res.status(200).json(result);

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
