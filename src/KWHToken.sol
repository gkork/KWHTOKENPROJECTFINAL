// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

interface IEnergySimulator {
    function simulateConsumption() external returns (uint256 kwh);
}

contract KWHToken is ERC20, ERC20Burnable, Ownable {
    enum PaymentModel { PREPAID, PAYG }

    struct User {
        PaymentModel paymentModel;
        uint256 consumption;     // συνολικά καταναλωμένες kWh
        uint256 pendingBill;     // εκκρεμές ποσό σε wei
        uint256 generatedKWH;    // kWh που έχει "παράγει"/επιβραβευθεί
    }

    // ---------- Τιμολόγηση ----------
    uint256 public fixedPricePerKWH;        // wei/kWh (PREPAID deficits)
    uint256 public fluctuatingPricePerKWH;  // wei/kWh (fallback αν δεν είναι dynamic)

    // Δυναμική fluctuating τιμή (0.00008–0.0002 ETH/kWh) ανά 15'
    uint256 public constant MIN_FLUCT_PRICE = 8e13;   // 0.00008 ETH
    uint256 public constant MAX_FLUCT_PRICE = 2e14;   // 0.00020 ETH
    uint256 public constant FLUCT_INTERVAL = 15 minutes;
    bool    public useDynamicFluct = true;
    bytes32 public fluctSeed; // για deterministic pseudo-random εντός παραθύρου

    // ---------- Λοιπά ----------
    IEnergySimulator public energySimulator;
    mapping(address => User) public users;

    // ---------- Events ----------
    event TokensBought(address indexed user, uint256 amount);
    event TokensBurned(address indexed user, uint256 amount);
    event TokensRewarded(address indexed user, uint256 amount);
    event KWHConsumed(address indexed user, uint256 kwh);
    event KWHGenerated(address indexed user, uint256 kwh);
    event BillGenerated(address indexed user, uint256 weiAmount);
    event BillPaid(address indexed user, uint256 weiAmount);
    event UserRegistered(address indexed user, PaymentModel model);
    event PriceUpdated(string priceType, uint256 newValue);
    event FluctPriceUsed(address indexed user, uint256 priceWeiPerKwh, uint256 intervalIndex);

    constructor(address simulator, address initialOwner)
        ERC20("KWHToken", "KWH")
        Ownable(initialOwner)
    {
        require(simulator != address(0), "sim=0");
        energySimulator = IEnergySimulator(simulator);

        fixedPricePerKWH = 1e14;        // 0.0001 ETH
        fluctuatingPricePerKWH = 2e14;  // default fallback 0.0002 ETH
        // seed για deterministic υπολογισμό (μπορείς να το αλλάξεις με setter αν θες)
        fluctSeed = keccak256(abi.encodePacked(simulator, initialOwner, block.timestamp, address(this)));
    }

    // ---------- View helpers ----------
    function decimals() public pure override returns (uint8) { return 18; }

    function getUserDetails(address acc) external view returns (User memory) {
        return users[acc];
    }

    // Τρέχουσα fluctuating τιμή (dynamic ή fallback)
    function currentFluctuatingPricePerKWH() public view returns (uint256) {
        if (!useDynamicFluct) return fluctuatingPricePerKWH;

        uint256 idx = block.timestamp / FLUCT_INTERVAL; // παράθυρο 15'
        // deterministic "τυχαίο" μέσα στο παράθυρο
        uint256 rand = uint256(keccak256(abi.encodePacked(idx, fluctSeed, address(this))));
        uint256 range = MAX_FLUCT_PRICE - MIN_FLUCT_PRICE;
        // ομοιόμορφη χαρτογράφηση στο [MIN, MAX]
        return MIN_FLUCT_PRICE + (rand % (range + 1));
    }

    function secondsUntilNextFluct() external view returns (uint256) {
        uint256 next = ((block.timestamp / FLUCT_INTERVAL) + 1) * FLUCT_INTERVAL;
        return next - block.timestamp;
    }

    // ---------- Διαχείριση τιμών (owner) ----------
    function setFixedPricePerKWH(uint256 newPrice) external onlyOwner {
        require(newPrice > 0, "price=0");
        fixedPricePerKWH = newPrice;
        emit PriceUpdated("fixedPricePerKWH", newPrice);
    }

    // Fallback/στατική fluctuating (αν useDynamicFluct=false)
    function setFluctuatingPricePerKWH(uint256 newPrice) external onlyOwner {
        require(newPrice >= MIN_FLUCT_PRICE && newPrice <= MAX_FLUCT_PRICE, "out of range");
        fluctuatingPricePerKWH = newPrice;
        emit PriceUpdated("fluctuatingPricePerKWH", newPrice);
    }

    function setUseDynamicFluct(bool useDyn) external onlyOwner {
        useDynamicFluct = useDyn;
        emit PriceUpdated("useDynamicFluct", useDyn ? 1 : 0);
    }

    function setFluctSeed(bytes32 newSeed) external onlyOwner {
        require(newSeed != bytes32(0), "seed=0");
        fluctSeed = newSeed;
        emit PriceUpdated("fluctSeed", uint256(newSeed));
    }

    // ---------- Εγγραφή χρήστη ----------
    function registerUser(uint8 model) external {
        require(model <= uint8(PaymentModel.PAYG), "bad model");
        users[msg.sender].paymentModel = PaymentModel(model);
        emit UserRegistered(msg.sender, PaymentModel(model));
    }

    // ---------- Αγορά PREPAID kWh (mint) ----------
    function buyTokens() external payable {
        require(fixedPricePerKWH > 0, "fixed=0");
        require(msg.value >= fixedPricePerKWH, "value too low");

        uint256 kwh = msg.value / fixedPricePerKWH; // ολόκληρες kWh
        uint256 amt = kwh * (10 ** decimals());
        _mint(msg.sender, amt);

        emit TokensBought(msg.sender, amt);
    }

    // ---------- Επιβράβευση παραγωγού ----------
    function rewardTokens(address prosumer, uint256 kwh) external onlyOwner {
        require(prosumer != address(0), "zero addr");
        uint256 amt = kwh * (10 ** decimals());
        _mint(prosumer, amt);
        users[prosumer].generatedKWH += kwh;

        emit TokensRewarded(prosumer, amt);
        emit KWHGenerated(prosumer, kwh);
    }

    // ---------- Προσομοίωση κατανάλωσης ----------
    function simulateConsumption() external {
        uint256 kwh = energySimulator.simulateConsumption();
        users[msg.sender].consumption += kwh;
        emit KWHConsumed(msg.sender, kwh);

        if (users[msg.sender].paymentModel == PaymentModel.PREPAID) {
            // Κατανάλωση από υπόλοιπο token, έλλειμμα → fixed τιμή
            uint256 need = kwh * (10 ** decimals());
            uint256 bal = balanceOf(msg.sender);
            if (bal >= need) {
                _burn(msg.sender, need);
                emit TokensBurned(msg.sender, need);
            } else {
                if (bal > 0) {
                    _burn(msg.sender, bal);
                    emit TokensBurned(msg.sender, bal);
                    uint256 coveredKwh = bal / (10 ** decimals());
                    uint256 deficit = kwh - coveredKwh;
                    uint256 weiAmt = deficit * fixedPricePerKWH;
                    users[msg.sender].pendingBill += weiAmt;
                    emit BillGenerated(msg.sender, weiAmt);
                } else {
                    uint256 weiAmt2 = kwh * fixedPricePerKWH;
                    users[msg.sender].pendingBill += weiAmt2;
                    emit BillGenerated(msg.sender, weiAmt2);
                }
            }
        } else {
            // PAYG: λογαριασμός με ΔΥΝΑΜΙΚΗ fluctuating τιμή της στιγμής
            uint256 price = currentFluctuatingPricePerKWH();
            uint256 weiAmt = kwh * price;
            users[msg.sender].pendingBill += weiAmt;

            uint256 idx = block.timestamp / FLUCT_INTERVAL;
            emit FluctPriceUsed(msg.sender, price, idx);
            emit BillGenerated(msg.sender, weiAmt);
        }
    }

    // ---------- Πληρωμή λογαριασμού ----------
    function payBill() external payable {
        uint256 bill = users[msg.sender].pendingBill;
        require(bill > 0, "no bill");
        require(msg.value > 0, "no value");

        uint256 payWei = msg.value >= bill ? bill : msg.value;
        users[msg.sender].pendingBill = bill - payWei;
        emit BillPaid(msg.sender, payWei);

        // Αν περισσέψει, γίνεται PREPAID αγορά
        if (msg.value > payWei && fixedPricePerKWH > 0) {
            uint256 extra = msg.value - payWei;
            uint256 kwh = extra / fixedPricePerKWH;
            if (kwh > 0) {
                uint256 amt = kwh * (10 ** decimals());
                _mint(msg.sender, amt);
                emit TokensBought(msg.sender, amt);
            }
        }
    }

    // ---------- Withdraw ----------
    function withdraw(address payable to, uint256 amount) external onlyOwner {
        if (amount == 0) amount = address(this).balance;
        require(amount <= address(this).balance, "insufficient");
        to.transfer(amount);
    }
}
