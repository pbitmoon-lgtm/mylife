// ═══════════════════════════════════════════════════════
// My Life — marketplace.js
// Data Marketplace anonimo e decentralizzato.
//
// CONCETTO:
//   L'utente possiede i suoi dati cifrati localmente.
//   Può scegliere di vendere versioni ANONIMIZZATE.
//   Riceve USDC direttamente nel suo wallet embedded.
//   myLife prende una fee del 10%.
//
// ARCHITETTURA:
//   1. L'utente seleziona categorie da condividere
//      (es. "posizioni anonime", "abitudini calendario")
//   2. I dati vengono anonimizzati localmente prima
//      di uscire dal device (mai dati raw)
//   3. Il pacchetto anonimizzato viene hashato e
//      registrato on-chain come "offerta"
//   4. I compratori (aziende, ricercatori) pagano USDC
//   5. Il pagamento sblocca il dataset
//
// CONTRATTO: MyLifeMarketplace.sol (da deployare)
//   - listDataset(bytes32 hash, uint256 price, string category)
//   - purchaseDataset(bytes32 hash)
//   - withdraw()
//
// PRIVACY GARANTITA:
//   - Nessun dato personale on-chain
//   - Solo hash del dataset anonimizzato
//   - L'indirizzo wallet non è collegato all'identità reale
//
// Comunica solo tramite State.dispatch/subscribe.
// ═══════════════════════════════════════════════════════

import State from './state.js';

const MarketplaceModule = (() => {

  // ─── CONFIGURAZIONE ───────────────────────────────────
  const CONFIG = {
    rpc:               'https://nova.arbitrum.io/rpc',
    chainId:           42170,
    contractAddress:   '0x0000000000000000000000000000000000000000', // TODO: deploy
    usdcAddress:       '0x750ba8b76187092B0D1E87E28daaf484d1b5273b', // USDC su Nova
    platformFee:       10,   // % trattenuta dalla piattaforma
    minPrice:          1,    // USDC minimo per dataset
    explorerBase:      'https://nova.arbiscan.io',
  };

  // ─── CATEGORIE DATI ───────────────────────────────────
  // Ogni categoria definisce cosa viene anonimizzato e come
  const CATEGORIES = {
    locations: {
      id:          'locations',
      label:       '📍 Posizioni anonime',
      description: 'Luoghi visitati senza coordinate precise (raggio 500m)',
      anonymize:   _anonymizeLocations,
    },
    calendar: {
      id:          'calendar',
      label:       '📅 Abitudini calendario',
      description: 'Frequenza eventi per categoria, senza testo',
      anonymize:   _anonymizeCalendar,
    },
    notes_topics: {
      id:          'notes_topics',
      label:       '📓 Argomenti note',
      description: 'Tag e argomenti frequenti, senza contenuto',
      anonymize:   _anonymizeNoteTopics,
    },
  };

  // ─── STATO INTERNO ────────────────────────────────────
  let _myListings  = [];   // dataset messi in vendita
  let _earnings    = 0;    // USDC guadagnati (da ritirare)

  // ─── ANONIMIZZAZIONE DATI ─────────────────────────────
  // Ogni funzione riceve dati raw e restituisce dati anonimi
  // I dati raw non escono MAI dal device

  function _anonymizeLocations(records) {
    // Raggruppa per zona (raggio 500m), rimuove timestamp precisi
    return records
      .filter(r => r.type === 'trip' && r.payload?.points?.length > 0)
      .map(r => ({
        // Arrotonda coordinate a 2 decimali (~1km precisione)
        zone: r.payload.points.map(p => ({
          lat: Math.round(p.lat * 100) / 100,
          lng: Math.round(p.lng * 100) / 100,
        })),
        // Solo giorno della settimana, non data precisa
        dayOfWeek: new Date(r.payload.startTime).getDay(),
        duration:  Math.round(r.payload.duration / 3600), // ore arrotondate
      }));
  }

  function _anonymizeCalendar(records) {
    // Conta eventi per categoria, rimuove titoli e note
    const counts = {};
    records
      .filter(r => r.type === 'event')
      .forEach(r => {
        const cat = r.payload.category || 'other';
        counts[cat] = (counts[cat] || 0) + 1;
      });
    return {
      eventCounts:  counts,
      totalEvents:  Object.values(counts).reduce((a, b) => a + b, 0),
      periodDays:   30, // aggregato su 30 giorni
    };
  }

  function _anonymizeNoteTopics(records) {
    // Estrae solo tag, non contenuto
    const tagCounts = {};
    records
      .filter(r => r.type === 'note' && r.payload?.tags?.length > 0)
      .forEach(r => {
        r.payload.tags.forEach(tag => {
          tagCounts[tag] = (tagCounts[tag] || 0) + 1;
        });
      });
    // Rimuovi tag troppo specifici (< 3 occorrenze = potenzialmente identificativi)
    return Object.fromEntries(
      Object.entries(tagCounts).filter(([_, count]) => count >= 3)
    );
  }

  // ─── PREPARAZIONE DATASET ─────────────────────────────

  async function prepareDataset(categoryId, records) {
    const category = CATEGORIES[categoryId];
    if (!category) throw new Error(`Categoria non trovata: ${categoryId}`);

    // Anonimizza localmente
    const anonymized = category.anonymize(records);

    if (!anonymized || (Array.isArray(anonymized) && anonymized.length === 0)) {
      throw new Error('Dataset vuoto dopo anonimizzazione');
    }

    // Crea pacchetto dataset
    const dataset = {
      version:    '1.0',
      category:   categoryId,
      label:      category.label,
      recordCount: Array.isArray(anonymized) ? anonymized.length : 1,
      createdAt:  new Date().toISOString().split('T')[0], // solo data, non ora
      data:       anonymized,
    };

    // Hash del dataset (fingerprint per on-chain)
    const encoded = new TextEncoder().encode(JSON.stringify(dataset));
    const hashBuf = await crypto.subtle.digest('SHA-256', encoded);
    const hash    = '0x' + Array.from(new Uint8Array(hashBuf))
      .map(b => b.toString(16).padStart(2, '0')).join('');

    return { dataset, hash, size: encoded.length };
  }

  // ─── METTI IN VENDITA ─────────────────────────────────

  async function listDataset({ categoryId, records, priceUsdc }) {
    if (!window.WalletModule?.isReady()) {
      State.dispatch('MARKETPLACE_ERROR', { error: 'Wallet non inizializzato' });
      return null;
    }

    if (priceUsdc < CONFIG.minPrice) {
      State.dispatch('MARKETPLACE_ERROR', {
        error: `Prezzo minimo: ${CONFIG.minPrice} USDC`
      });
      return null;
    }

    State.dispatch('MARKETPLACE_LISTING_START', { categoryId });

    try {
      // 1. Anonimizza e prepara
      const { dataset, hash, size } = await prepareDataset(categoryId, records);
      console.log(`[marketplace] dataset pronto: ${hash} (${Math.round(size/1024)}KB)`);

      // 2. Carica dataset anonimizzato su Arweave (storage permanente)
      State.dispatch('MARKETPLACE_UPLOADING', { categoryId });
      const arweaveUrl = await _uploadToArweave(dataset);
      if (!arweaveUrl) throw new Error('Upload Arweave fallito');

      // 3. Registra on-chain: hash + prezzo + url
      State.dispatch('MARKETPLACE_REGISTERING', { categoryId });
      const txHash = await _registerOnChain({ hash, priceUsdc, categoryId, arweaveUrl });

      // 4. Salva localmente
      const listing = {
        id:          hash,
        categoryId,
        label:       CATEGORIES[categoryId].label,
        priceUsdc,
        arweaveUrl,
        txHash,
        createdAt:   new Date().toISOString(),
        status:      'active',
        purchases:   0,
        earned:      0,
      };
      _myListings.push(listing);
      _persistListings();

      State.dispatch('MARKETPLACE_LISTED', { listing });
      console.log(`[marketplace] ✅ dataset in vendita: ${hash}`);
      return listing;

    } catch (err) {
      console.error('[marketplace] errore listing:', err);
      State.dispatch('MARKETPLACE_ERROR', { error: err.message });
      return null;
    }
  }

  // ─── UPLOAD ARWEAVE ───────────────────────────────────

  async function _uploadToArweave(dataset) {
    const encoded = new TextEncoder().encode(JSON.stringify(dataset));

    // Sotto 100KB → gratuito
    if (encoded.length > 100 * 1024) {
      throw new Error('Dataset troppo grande per upload gratuito (max 100KB)');
    }

    const res = await fetch('https://arweave.net/tx', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'X-App-Name': 'MyLife-Marketplace' },
      body:    encoded,
    });

    if (!res.ok) throw new Error(`Arweave HTTP ${res.status}`);
    const { id } = await res.json();
    return `https://arweave.net/${id}`;
  }

  // ─── REGISTRAZIONE ON-CHAIN ───────────────────────────

  async function _registerOnChain({ hash, priceUsdc, categoryId, arweaveUrl }) {
    if (CONFIG.contractAddress === '0x0000000000000000000000000000000000000000') {
      // Contratto non ancora deployato — simula per ora
      console.warn('[marketplace] contratto non deployato — simulazione');
      return '0xsimulated_' + hash.slice(2, 10);
    }

    const privKeyHex = window.WalletModule?.getPrivateKeyHex?.();
    if (!privKeyHex) throw new Error('Wallet non disponibile');

    const provider = new ethers.JsonRpcProvider(CONFIG.rpc);
    const wallet   = new ethers.Wallet('0x' + privKeyHex, provider);

    // ABI minimo del marketplace contract
    const abi = [
      'function listDataset(bytes32 hash, uint256 priceUsdc, string category, string arweaveUrl) external',
      'function purchaseDataset(bytes32 hash) external',
      'function withdraw() external',
      'function getDataset(bytes32 hash) external view returns (address seller, uint256 price, string category, string url, uint256 purchases)',
    ];

    const contract = new ethers.Contract(CONFIG.contractAddress, abi, wallet);
    const priceWei = ethers.parseUnits(priceUsdc.toString(), 6); // USDC ha 6 decimali

    const tx = await contract.listDataset(hash, priceWei, categoryId, arweaveUrl);
    await tx.wait();
    return tx.hash;
  }

  // ─── RITIRA GUADAGNI ──────────────────────────────────

  async function withdrawEarnings() {
    if (_earnings <= 0) {
      State.dispatch('MARKETPLACE_ERROR', { error: 'Nessun guadagno da ritirare' });
      return;
    }

    State.dispatch('MARKETPLACE_WITHDRAWING');
    try {
      if (CONFIG.contractAddress === '0x0000000000000000000000000000000000000000') {
        console.warn('[marketplace] simulazione withdraw');
        State.dispatch('MARKETPLACE_WITHDRAWN', { amount: _earnings });
        return;
      }

      const privKeyHex = window.WalletModule?.getPrivateKeyHex?.();
      const provider   = new ethers.JsonRpcProvider(CONFIG.rpc);
      const wallet     = new ethers.Wallet('0x' + privKeyHex, provider);
      const abi        = ['function withdraw() external'];
      const contract   = new ethers.Contract(CONFIG.contractAddress, abi, wallet);

      const tx = await contract.withdraw();
      await tx.wait();

      State.dispatch('MARKETPLACE_WITHDRAWN', {
        amount:      _earnings,
        txHash:      tx.hash,
        explorerUrl: `${CONFIG.explorerBase}/tx/${tx.hash}`,
      });
      _earnings = 0;

    } catch (err) {
      State.dispatch('MARKETPLACE_ERROR', { error: err.message });
    }
  }

  // ─── CARICA LISTINGS UTENTE ───────────────────────────

  function loadMyListings() {
    const address = window.WalletModule?.getAddress();
    if (!address) return [];
    const stored = localStorage.getItem(`ml_marketplace_${address}`);
    _myListings = stored ? JSON.parse(stored) : [];
    State.dispatch('MARKETPLACE_LISTINGS_LOADED', { listings: _myListings });
    return _myListings;
  }

  function _persistListings() {
    const address = window.WalletModule?.getAddress();
    if (!address) return;
    localStorage.setItem(`ml_marketplace_${address}`, JSON.stringify(_myListings));
  }

  // ─── STIMA GUADAGNO ───────────────────────────────────
  // Aiuta l'utente a capire quanto potrebbe guadagnare

  function estimateEarnings(categoryId, priceUsdc, expectedPurchases = 10) {
    const gross     = priceUsdc * expectedPurchases;
    const fee       = gross * CONFIG.platformFee / 100;
    const net       = gross - fee;
    return { gross, fee, net, platformFee: CONFIG.platformFee };
  }

  // ─── ASCOLTA EVENTI ───────────────────────────────────

  State.subscribe('INTENT_LIST_DATASET', async ({ categoryId, records, priceUsdc }) => {
    await listDataset({ categoryId, records, priceUsdc });
  });

  State.subscribe('INTENT_WITHDRAW_EARNINGS', async () => {
    await withdrawEarnings();
  });

  State.subscribe('INTENT_LOAD_MY_LISTINGS', () => {
    loadMyListings();
  });

  State.subscribe('WALLET_READY', ({ address }) => {
    console.log(`[marketplace] wallet pronto: ${address}`);
    loadMyListings();
  });

  State.subscribe('APP_READY', () => {
    console.log('[marketplace] modulo pronto');
  });

  // ─── API PUBBLICA ─────────────────────────────────────
  const pub = {
    listDataset,
    withdrawEarnings,
    loadMyListings,
    estimateEarnings,
    getListings:    () => _myListings,
    getEarnings:    () => _earnings,
    getCategories:  () => CATEGORIES,
    config:         CONFIG,
  };

  window.MarketplaceModule = pub;
  return pub;

})();

export default MarketplaceModule;
