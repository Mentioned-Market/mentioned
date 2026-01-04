// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title MockUSDC
 * @notice Mock USDC for demo/testing with public faucet
 * @dev Anyone can mint tokens - perfect for demos where users need instant funding
 */
contract MockUSDC is ERC20 {
    uint256 public constant FAUCET_AMOUNT = 10000 * 1e6; // 10,000 USDC per request
    uint256 public constant COOLDOWN_TIME = 1 hours;
    
    mapping(address => uint256) public lastFaucetClaim;

    event FaucetClaimed(address indexed user, uint256 amount);

    constructor() ERC20("Mock USD Coin", "mUSDC") {
        // Mint initial supply to deployer for setup
        _mint(msg.sender, 10000000 * 1e6); // 10M USDC
    }

    /**
     * @notice Public faucet - anyone can claim USDC with cooldown
     * @dev Perfect for demo users who need instant funding
     */
    function faucet() external {
        if (lastFaucetClaim[msg.sender] > 0) {
            require(
                block.timestamp >= lastFaucetClaim[msg.sender] + COOLDOWN_TIME,
                "Faucet cooldown active"
            );
        }
        
        lastFaucetClaim[msg.sender] = block.timestamp;
        _mint(msg.sender, FAUCET_AMOUNT);
        
        emit FaucetClaimed(msg.sender, FAUCET_AMOUNT);
    }

    /**
     * @notice Mint tokens to any address (for admin/demo purposes)
     * @dev No restrictions - this is a demo token
     */
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    /**
     * @notice Mint to multiple addresses at once
     * @dev Useful for funding multiple demo wallets
     */
    function mintBatch(address[] calldata recipients, uint256[] calldata amounts) external {
        require(recipients.length == amounts.length, "Arrays length mismatch");
        
        for (uint256 i = 0; i < recipients.length; i++) {
            _mint(recipients[i], amounts[i]);
        }
    }

    /**
     * @notice Give a standard demo amount to multiple users
     * @dev Quick way to fund multiple wallets with same amount
     */
    function fundDemoWallets(address[] calldata wallets, uint256 amount) external {
        for (uint256 i = 0; i < wallets.length; i++) {
            _mint(wallets[i], amount);
        }
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }
}

contract DeployMockUSDC is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        
        vm.startBroadcast(deployerPrivateKey);

        MockUSDC usdc = new MockUSDC();

        console.log("MockUSDC deployed at:", address(usdc));
        console.log("Initial supply:", usdc.totalSupply());

        vm.stopBroadcast();
    }
}

