// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 *  KWHToken
 *  - ERC20 με 18 δεκαδικά (1 token = 1 kWh)
 *  - Τιμή kWh (fixed & fluctuating) σε wei/kWh
 *  - PREPAID: αγορά kWh προκαταβολικά (buyTokens)
 *  - PAYG: προκύπτει pendingBill
 *  - simulateConsumption: παίρνει kWh από EnergySimulator και ενημερώνει τον χρήστη
 */
interface IEnergySimulator {
    function simulateConsumption() external returns (uint256 kwh);
}

contract KWHToken is ERC20, ERC20Burnable, Ownable {
    // ====== Τύποι / Δομές ======
    enum PaymentModel { PREPAID, PAYG }

    struct User {
        PaymentModel paymentModel;
        uint256 consumption;     // συνολικά καταναλωμένες kWh
        uint256 pendingBill;     // εκκρεμές ποσό σε wei
        uint256 generatedKWH;    // kWh που έχει "παράγει"/επιβραβευθεί
    }

    // ====== Κατάσταση ======
    IEnergySimulator public energySimulator;      // getter στο ABI: energySimulator()
    uint256 public fixedPricePerKWH;             // wei per kWh
    uint256 public fluctuatingPricePerKWH;       // wei per kWh (για PAYG)

    mapping(address => User) public users;       // ABI accessor: users(address) -> fields

    // ====== Events ======
    event TokensBought(address indexed user, uint256 amount);
    event TokensBurned(address indexed user, uint256 amount);
    event TokensRewarded(address indexed user, uint256 amount);
    event KWHConsumed(address indexed user, uint256 kwh);
    event KWHGenerated(address indexed user, uint256 kwh);
    event BillGenerated(address indexed user, uint256 weiAmount);
    event BillPaid(address indexed user, uint256 weiAmount);
    event UserRegistered(address indexed user, PaymentModel model);
    event PriceUpdated(string priceType, uint256 newValue);

    // ====== Constructor ======
    // constructor(address simulator, address initialOwner)
    constructor(address simulator, address initialOwner)
        ERC20("KWHToken", "KWH")
        Ownable(initialOwner)
    {
        require(simulator != address(0), "sim=0");
        energySimulator = IEnergySimulator(simulator);

        // default τιμές για demo (μπορείς να τις αλλάξεις με τα setters)
        fixedPricePerKWH = 1e14;        // 0.0001 ETH per kWh
        fluctuatingPricePerKWH = 2e14;  // 0.0002 ETH per kWh
    }

    // ====== View helpers ======
    function decimals() public pure override returns (uint8) { return 18; }

    function getUserDetails(address acc)
        external
        view
        returns (User memory)
    {
        return users[acc];
    }

    // ====== Διαχείριση τιμών (owner) ======
    function setFixedPricePerKWH(uint256 newPrice) external onlyOwner {
        require(newPrice > 0, "price=0");
        fixedPricePerKWH = newPrice;
        emit PriceUpdated("fixedPricePerKWH", newPrice);
    }

    function setFluctuatingPricePerKWH(uint256 newPrice) external onlyOwner {
        require(newPrice > 0, "price=0");
        fluctuatingPricePerKWH = newPrice;
        emit PriceUpdated("fluctuatingPricePerKWH", newPrice);
    }

    // ====== Εγγραφή / αλλαγή μοντέλου χρήστη ======
    function registerUser(uint8 model) external {
        require(model <= uint8(PaymentModel.PAYG), "bad model");
        users[msg.sender].paymentModel = PaymentModel(model);
        emit UserRegistered(msg.sender, PaymentModel(model));
    }

    // ====== Αγορά PREPAID kWh (mint) ======
    // value = kWh * fixedPricePerKWH
    function buyTokens() external payable {
        require(fixedPricePerKWH > 0, "fixed=0");
        require(msg.value >= fixedPricePerKWH, "value too low");

        uint256 kwh = msg.value / fixedPricePerKWH; // ολόκληρες kWh
        uint256 amt = kwh * (10 ** decimals());
        _mint(msg.sender, amt);

        emit TokensBought(msg.sender, amt);
    }

    // ====== Επιβράβευση παραγωγού (mint) ======
    function rewardTokens(address prosumer, uint256 kwh) external onlyOwner {
        require(prosumer != address(0), "zero addr");
        uint256 amt = kwh * (10 ** decimals());
        _mint(prosumer, amt);
        users[prosumer].generatedKWH += kwh;

        emit TokensRewarded(prosumer, amt);
        emit KWHGenerated(prosumer, kwh);
    }

    // ====== Προσομοίωση κατανάλωσης (καλεί τον EnergySimulator) ======
    // Για demo αφήνουμε public – αν θέλεις, βάλε onlyOwner/onlySimulator.
    function simulateConsumption() external {
        // Πάρε kWh από τον simulator
        uint256 kwh = energySimulator.simulateConsumption();
        users[msg.sender].consumption += kwh;
        emit KWHConsumed(msg.sender, kwh);

        if (users[msg.sender].paymentModel == PaymentModel.PREPAID) {
            // Κατανάλωση από υπόλοιπο token
            uint256 need = kwh * (10 ** decimals());

            uint256 bal = balanceOf(msg.sender);
            if (bal >= need) {
                _burn(msg.sender, need);
                emit TokensBurned(msg.sender, need);
            } else {
                // Ό,τι δεν καλύπτεται, το μετατρέπουμε σε λογαριασμό με fixed τιμή
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
            // PAYG: λογαριασμός με τη fluctuating τιμή
            uint256 weiAmt = kwh * fluctuatingPricePerKWH;
            users[msg.sender].pendingBill += weiAmt;
            emit BillGenerated(msg.sender, weiAmt);
        }
    }

    // ====== Πληρωμή λογαριασμού ======
    // Αν πληρώσει παραπάνω, μετατρέπουμε το extra σε PREPAID tokens με fixed τιμή.
    function payBill() external payable {
        uint256 bill = users[msg.sender].pendingBill;
        require(bill > 0, "no bill");
        require(msg.value > 0, "no value");

        uint256 payWei = msg.value >= bill ? bill : msg.value;
        users[msg.sender].pendingBill = bill - payWei;
        emit BillPaid(msg.sender, payWei);

        // Αν περίσσεψε value πάνω από τον λογαριασμό ⇒ αγορά PREPAID
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

    // ====== (προαιρετικά) Withdraw της ETH δεξαμενής στον owner ======
    function withdraw(address payable to, uint256 amount) external onlyOwner {
        if (amount == 0) amount = address(this).balance;
        require(amount <= address(this).balance, "insufficient");
        to.transfer(amount);
    }
}
