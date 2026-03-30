// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function allowance(address owner, address spender) external view returns (uint256);
}

/**
 * @title MyLifeMarketplace
 * @notice Marketplace dati anonimi per MyLife.
 *
 * Flusso:
 *   1. Venditore chiama listDataset() con hash, prezzo, categoria, url Arweave
 *   2. Compratore chiama purchaseDataset() pagando in USDC
 *   3. USDC va al contratto (90% venditore, 10% piattaforma)
 *   4. Venditore chiama withdraw() per ritirare i guadagni
 *   5. Compratore ottiene l'url Arweave per scaricare il dataset
 *
 * Privacy:
 *   - On-chain c'è solo l'hash del dataset anonimizzato
 *   - Il dataset reale è su Arweave (cifrato o anonimizzato)
 *   - Nessun dato personale on-chain
 */
contract MyLifeMarketplace {

    // ─── STRUTTURE ────────────────────────────────────────
    struct Dataset {
        address  seller;
        uint256  priceUsdc;    // in USDC (6 decimali)
        string   category;     // "locations", "calendar", "notes_topics"
        string   arweaveUrl;   // URL del dataset su Arweave
        uint256  purchases;    // numero di acquisti
        bool     active;       // il venditore può disattivarlo
        uint256  createdAt;
    }

    struct Purchase {
        address buyer;
        bytes32 datasetHash;
        uint256 paidUsdc;
        uint256 purchasedAt;
    }

    // ─── STATO ────────────────────────────────────────────
    address public  owner;          // piattaforma MyLife
    IERC20  public  usdc;           // contratto USDC su Nova
    uint256 public  platformFee;    // percentuale (es. 10 = 10%)

    mapping(bytes32 => Dataset)   public datasets;
    mapping(address => uint256)   public pendingWithdrawals; // USDC da ritirare
    mapping(address => Purchase[]) private _purchases;       // storico acquisti

    bytes32[] public allDatasetHashes; // indice pubblico

    // ─── EVENTI ───────────────────────────────────────────
    event DatasetListed(bytes32 indexed hash, address indexed seller, uint256 price, string category);
    event DatasetPurchased(bytes32 indexed hash, address indexed buyer, uint256 price);
    event Withdrawn(address indexed seller, uint256 amount);
    event DatasetDeactivated(bytes32 indexed hash);

    // ─── MODIFICATORI ─────────────────────────────────────
    modifier onlyOwner() { require(msg.sender == owner, "Solo owner"); _; }

    // ─── COSTRUTTORE ──────────────────────────────────────
    constructor(address _usdc, uint256 _platformFee) {
        require(_usdc != address(0), "USDC address invalido");
        require(_platformFee <= 30, "Fee massima 30%");
        owner       = msg.sender;
        usdc        = IERC20(_usdc);
        platformFee = _platformFee;
    }

    // ─── VENDITA ──────────────────────────────────────────

    /**
     * @notice Mette in vendita un dataset anonimizzato
     * @param hash       SHA-256 del contenuto del dataset
     * @param priceUsdc  Prezzo in USDC (con 6 decimali, es. 1000000 = 1 USDC)
     * @param category   Categoria ("locations", "calendar", "notes_topics")
     * @param arweaveUrl URL del dataset su Arweave
     */
    function listDataset(
        bytes32 hash,
        uint256 priceUsdc,
        string calldata category,
        string calldata arweaveUrl
    ) external {
        require(datasets[hash].seller == address(0), "Dataset gia esistente");
        require(priceUsdc >= 1_000_000, "Prezzo minimo 1 USDC");
        require(bytes(category).length > 0, "Categoria vuota");
        require(bytes(arweaveUrl).length > 0, "URL vuoto");

        datasets[hash] = Dataset({
            seller:     msg.sender,
            priceUsdc:  priceUsdc,
            category:   category,
            arweaveUrl: arweaveUrl,
            purchases:  0,
            active:     true,
            createdAt:  block.timestamp,
        });

        allDatasetHashes.push(hash);
        emit DatasetListed(hash, msg.sender, priceUsdc, category);
    }

    // ─── ACQUISTO ─────────────────────────────────────────

    /**
     * @notice Acquista un dataset pagando in USDC
     * @param hash Hash del dataset da acquistare
     */
    function purchaseDataset(bytes32 hash) external {
        Dataset storage ds = datasets[hash];
        require(ds.seller != address(0), "Dataset non trovato");
        require(ds.active, "Dataset non attivo");
        require(ds.seller != msg.sender, "Non puoi comprare il tuo dataset");

        uint256 price     = ds.priceUsdc;
        uint256 fee       = price * platformFee / 100;
        uint256 sellerAmt = price - fee;

        // Trasferisci USDC dal compratore al contratto
        require(
            usdc.transferFrom(msg.sender, address(this), price),
            "Trasferimento USDC fallito"
        );

        // Accredita venditore e piattaforma
        pendingWithdrawals[ds.seller] += sellerAmt;
        pendingWithdrawals[owner]     += fee;

        ds.purchases++;

        _purchases[msg.sender].push(Purchase({
            buyer:       msg.sender,
            datasetHash: hash,
            paidUsdc:    price,
            purchasedAt: block.timestamp,
        }));

        emit DatasetPurchased(hash, msg.sender, price);
    }

    // ─── RITIRO GUADAGNI ──────────────────────────────────

    /**
     * @notice Ritira i guadagni accumulati (pattern pull payment)
     */
    function withdraw() external {
        uint256 amount = pendingWithdrawals[msg.sender];
        require(amount > 0, "Nessun guadagno da ritirare");

        pendingWithdrawals[msg.sender] = 0;
        require(usdc.transfer(msg.sender, amount), "Trasferimento USDC fallito");

        emit Withdrawn(msg.sender, amount);
    }

    // ─── DISATTIVA DATASET ────────────────────────────────

    function deactivateDataset(bytes32 hash) external {
        require(datasets[hash].seller == msg.sender, "Non sei il venditore");
        datasets[hash].active = false;
        emit DatasetDeactivated(hash);
    }

    // ─── VIEW FUNCTIONS ───────────────────────────────────

    function getDataset(bytes32 hash) external view returns (
        address seller, uint256 price, string memory category,
        string memory arweaveUrl, uint256 purchases, bool active
    ) {
        Dataset storage ds = datasets[hash];
        return (ds.seller, ds.priceUsdc, ds.category, ds.arweaveUrl, ds.purchases, ds.active);
    }

    function getMyPurchases() external view returns (Purchase[] memory) {
        return _purchases[msg.sender];
    }

    function getTotalDatasets() external view returns (uint256) {
        return allDatasetHashes.length;
    }

    function getDatasetsByCategory(string calldata category)
        external view returns (bytes32[] memory)
    {
        uint256 count = 0;
        for (uint256 i = 0; i < allDatasetHashes.length; i++) {
            if (keccak256(bytes(datasets[allDatasetHashes[i]].category)) ==
                keccak256(bytes(category))) count++;
        }
        bytes32[] memory result = new bytes32[](count);
        uint256 idx = 0;
        for (uint256 i = 0; i < allDatasetHashes.length; i++) {
            if (keccak256(bytes(datasets[allDatasetHashes[i]].category)) ==
                keccak256(bytes(category))) result[idx++] = allDatasetHashes[i];
        }
        return result;
    }

    // ─── ADMIN ────────────────────────────────────────────

    function setPlatformFee(uint256 _fee) external onlyOwner {
        require(_fee <= 30, "Fee massima 30%");
        platformFee = _fee;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Indirizzo invalido");
        owner = newOwner;
    }
}
