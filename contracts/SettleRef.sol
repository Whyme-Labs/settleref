// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @title SettleRef
/// @notice Capped, non-upgradeable payment experiment for native USDC on Arc.
/// @dev Native units use 18 decimals. No token approvals, fees, admin, or escrow.
/// Duplicate protection is per payer, instruction ID, and contract deployment.
contract SettleRef {
    uint256 public constant MAX_PAYMENT = 1 ether; // 1 USDC on Arc, not ETH.
    uint256 public constant MICRO_USDC = 1e12; // 6-decimal business amounts.
    mapping(address payer => mapping(bytes32 instructionId => bool)) public settled;
    bool private entered;

    error DuplicateInstruction();
    error InvalidInstruction();
    error InvalidBeneficiary();
    error InvalidAmount();
    error ExpiredInstruction();
    error TransferFailed();
    error ReentrantCall();

    event Settled(
        address indexed payer,
        bytes32 indexed instructionId,
        address indexed beneficiary,
        uint256 amount,
        bytes32 contentHash,
        uint64 expiresAt
    );

    /// @notice Pays the exact beneficiary or reverts the entire operation.
    /// @dev The caller signs these fields. The contract cannot interpret invoice content.
    function settle(
        bytes32 instructionId,
        address payable beneficiary,
        uint256 amount,
        bytes32 contentHash,
        uint64 expiresAt
    ) external payable {
        if (entered) revert ReentrantCall();
        if (instructionId == bytes32(0) || contentHash == bytes32(0)) revert InvalidInstruction();
        if (beneficiary == address(0) || beneficiary == address(this) || beneficiary == msg.sender) {
            revert InvalidBeneficiary();
        }
        if (amount == 0 || amount > MAX_PAYMENT || amount != msg.value || amount % MICRO_USDC != 0) {
            revert InvalidAmount();
        }
        if (block.timestamp >= expiresAt) revert ExpiredInstruction();
        if (settled[msg.sender][instructionId]) revert DuplicateInstruction();

        // Effects precede interaction. A failed transfer rolls the flag back.
        entered = true;
        settled[msg.sender][instructionId] = true;
        (bool success,) = beneficiary.call{value: amount}("");
        if (!success) revert TransferFailed();
        emit Settled(msg.sender, instructionId, beneficiary, amount, contentHash, expiresAt);
        entered = false;
    }
}
