// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {SettleRef} from "../SettleRef.sol";
interface Vm {
    function deal(address who, uint256 amount) external;
    function prank(address sender) external;
    function warp(uint256 timestamp) external;
    function expectRevert(bytes4 selector) external;
    function expectEmit(bool,bool,bool,bool,address) external;
}
contract RejectPayment { receive() external payable { revert("no"); } }
contract ReentrantReceiver {
    SettleRef private target;
    bool public blocked;
    constructor(SettleRef t) { target = t; }
    receive() external payable {
        try target.settle{value: msg.value}(bytes32(uint256(2)), payable(address(0x777)), msg.value, bytes32(uint256(3)), uint64(block.timestamp + 100)) {
            revert("reentry succeeded");
        } catch(bytes memory reason) {
            require(reason.length >= 4 && bytes4(reason) == SettleRef.ReentrantCall.selector, "wrong rejection");
            blocked = true;
        }
    }
}
contract SettleRefTest {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    SettleRef s;
    address payer = address(0xA11CE);
    address payable recipient = payable(address(0xB0B));
    bytes32 constant ID = keccak256("invoice-1");
    bytes32 constant CONTENT = keccak256("content-1");
    uint64 constant EXPIRY = 2000;
    event Settled(address indexed payer, bytes32 indexed instructionId, address indexed beneficiary, uint256 amount, bytes32 contentHash, uint64 expiresAt);
    function setUp() public { s = new SettleRef(); vm.warp(1000); vm.deal(payer, 100 ether); }
    function pay(uint256 amount) internal { vm.prank(payer); s.settle{value: amount}(ID,recipient,amount,CONTENT,EXPIRY); }
    function testExactTransferAndNoRetainedBalance() public {
        uint256 beforeBalance = recipient.balance; pay(0.1 ether);
        require(recipient.balance == beforeBalance + 0.1 ether);
        require(address(s).balance == 0); require(s.settled(payer,ID));
    }
    function testEventAndStaticAbi() public {
        require(SettleRef.settle.selector == bytes4(0x355b5dd4));
        require(keccak256("Settled(address,bytes32,address,uint256,bytes32,uint64)") == 0x62d217e5449ea37cc82d49f6ade136c256d3a8c81b72e30bcd42cd6f611cf876);
        vm.expectEmit(true,true,true,true,address(s)); emit Settled(payer,ID,recipient,0.1 ether,CONTENT,EXPIRY); pay(0.1 ether);
    }
    function testDuplicateRejected() public { pay(0.1 ether); vm.expectRevert(SettleRef.DuplicateInstruction.selector); pay(0.1 ether); }
    function testChangedPayloadDoesNotBypassDuplicate() public {
        pay(0.1 ether); vm.expectRevert(SettleRef.DuplicateInstruction.selector); vm.prank(payer);
        s.settle{value: 0.2 ether}(ID,payable(address(0xC0)),0.2 ether,bytes32(uint256(999)),EXPIRY + 100);
    }
    function testOtherPayerCannotConsumeVictimId() public {
        address attacker = address(0xBAD); vm.deal(attacker,1 ether); vm.prank(attacker);
        s.settle{value: 0.1 ether}(ID,recipient,0.1 ether,CONTENT,EXPIRY);
        require(!s.settled(payer,ID)); pay(0.1 ether); require(s.settled(payer,ID));
    }
    function testRejectExpiredAtBoundary() public { vm.warp(EXPIRY); vm.expectRevert(SettleRef.ExpiredInstruction.selector); pay(0.1 ether); }
    function testRejectOverCap() public { vm.expectRevert(SettleRef.InvalidAmount.selector); pay(1 ether + 1e12); }
    function testRejectZero() public { vm.expectRevert(SettleRef.InvalidAmount.selector); pay(0); }
    function testRejectSubMicroPrecision() public { vm.expectRevert(SettleRef.InvalidAmount.selector); pay(1); }
    function testRejectWrongValue() public { vm.expectRevert(SettleRef.InvalidAmount.selector); vm.prank(payer); s.settle{value: 0.2 ether}(ID,recipient,0.1 ether,CONTENT,EXPIRY); }
    function testRejectZeroInstruction() public { vm.expectRevert(SettleRef.InvalidInstruction.selector); vm.prank(payer); s.settle{value: 0.1 ether}(bytes32(0),recipient,0.1 ether,CONTENT,EXPIRY); }
    function testRejectZeroCommitment() public { vm.expectRevert(SettleRef.InvalidInstruction.selector); vm.prank(payer); s.settle{value: 0.1 ether}(ID,recipient,0.1 ether,bytes32(0),EXPIRY); }
    function testRejectZeroRecipient() public { vm.expectRevert(SettleRef.InvalidBeneficiary.selector); vm.prank(payer); s.settle{value: 0.1 ether}(ID,payable(address(0)),0.1 ether,CONTENT,EXPIRY); }
    function testRejectSelfRecipient() public { vm.expectRevert(SettleRef.InvalidBeneficiary.selector); vm.prank(payer); s.settle{value: 0.1 ether}(ID,payable(payer),0.1 ether,CONTENT,EXPIRY); }
    function testRejectContractRecipient() public { vm.expectRevert(SettleRef.InvalidBeneficiary.selector); vm.prank(payer); s.settle{value: 0.1 ether}(ID,payable(address(s)),0.1 ether,CONTENT,EXPIRY); }
    function testFailedTransferRollsBackAndAllowsRetry() public {
        RejectPayment reject = new RejectPayment(); uint256 beforeBalance = payer.balance;
        vm.expectRevert(SettleRef.TransferFailed.selector); vm.prank(payer);
        s.settle{value: 0.1 ether}(ID,payable(address(reject)),0.1 ether,CONTENT,EXPIRY);
        require(!s.settled(payer,ID)); require(payer.balance == beforeBalance); require(address(s).balance == 0);
        pay(0.1 ether); require(s.settled(payer,ID));
    }
    function testReentryBlocked() public {
        ReentrantReceiver receiver = new ReentrantReceiver(s); vm.prank(payer);
        s.settle{value: 0.1 ether}(ID,payable(address(receiver)),0.1 ether,CONTENT,EXPIRY);
        require(receiver.blocked()); require(address(receiver).balance == 0.1 ether); require(address(s).balance == 0);
    }
    function testFuzzExactMicroPayments(uint64 raw) public {
        uint256 amount = (uint256(raw) % 1_000_000 + 1) * 1e12;
        uint256 beforeBalance = recipient.balance; pay(amount);
        require(recipient.balance == beforeBalance + amount); require(address(s).balance == 0);
        vm.expectRevert(SettleRef.DuplicateInstruction.selector); pay(amount);
    }
}
