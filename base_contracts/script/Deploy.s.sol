// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/MentionedMarket.sol";

// Import MockUSDC
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockUSDC is ERC20 {
    uint256 public constant FAUCET_AMOUNT = 10000 * 1e6;
    uint256 public constant COOLDOWN_TIME = 1 hours;
    
    mapping(address => uint256) public lastFaucetClaim;
    event FaucetClaimed(address indexed user, uint256 amount);

    constructor() ERC20("Mock USD Coin", "mUSDC") {
        _mint(msg.sender, 10000000 * 1e6);
    }

    function faucet() external {
        if (lastFaucetClaim[msg.sender] > 0) {
            require(block.timestamp >= lastFaucetClaim[msg.sender] + COOLDOWN_TIME, "Faucet cooldown active");
        }
        lastFaucetClaim[msg.sender] = block.timestamp;
        _mint(msg.sender, FAUCET_AMOUNT);
        emit FaucetClaimed(msg.sender, FAUCET_AMOUNT);
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function mintBatch(address[] calldata recipients, uint256[] calldata amounts) external {
        require(recipients.length == amounts.length, "Arrays length mismatch");
        for (uint256 i = 0; i < recipients.length; i++) {
            _mint(recipients[i], amounts[i]);
        }
    }

    function fundDemoWallets(address[] calldata wallets, uint256 amount) external {
        for (uint256 i = 0; i < wallets.length; i++) {
            _mint(wallets[i], amount);
        }
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }
}

/**
 * @title DeployMentionedMarket
 * @notice Deploys MockUSDC and MentionedMarket together for easy demo setup
 */
contract DeployMentionedMarket is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        
        vm.startBroadcast(deployerPrivateKey);

        // Deploy MockUSDC first
        MockUSDC usdc = new MockUSDC();
        console.log("MockUSDC deployed at:", address(usdc));
        console.log("MockUSDC has public faucet (10,000 mUSDC per claim)");

        // Deploy the market contract with MockUSDC
        MentionedMarket market = new MentionedMarket(address(usdc));
        console.log("MentionedMarket deployed at:", address(market));
        console.log("Owner:", market.owner());
        
        // Fund the deployer with some USDC for initial setup
        usdc.mint(deployer, 100000 * 1e6); // 100k USDC
        console.log("Funded deployer with 100,000 mUSDC");

        vm.stopBroadcast();

        console.log("\n=== DEPLOYMENT SUMMARY ===");
        console.log("MockUSDC:", address(usdc));
        console.log("MentionedMarket:", address(market));
        console.log("\nUsers can call usdc.faucet() to get 10,000 mUSDC");
        console.log("Or use usdc.mint(address, amount) for custom amounts");
    }
}

