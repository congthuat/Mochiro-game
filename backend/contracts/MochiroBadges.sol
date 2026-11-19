// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/**
 * @title Mochiro Badges
 * @notice Achievement badges for Mochiro, the endless runner on Arc. Each badge is an
 * ERC-721 token that can never be transferred (soulbound, ERC-5192): it is a keepsake of
 * what its holder did, not something to trade.
 *
 * A player mints their own badge and pays the network fee. The game server only signs a
 * short-lived voucher once it has checked the goal was reached on runs it verified, so a
 * badge cannot be minted for a goal that was never met. Each wallet holds each badge at
 * most once, and the token id is derived from (badge, holder) so it never collides.
 */
contract MochiroBadges {
    string public constant name = "Mochiro Badges";
    string public constant symbol = "MOCHIRO";

    address public owner;
    address public signer;
    string public baseURI;
    uint256 public totalSupply;

    /// Bit `b` is set when the wallet holds badge `b`.
    mapping(address => uint256) public badgesOf;
    mapping(uint256 => address) private _ownerOf;
    mapping(address => uint256) private _balanceOf;

    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event Locked(uint256 tokenId);
    event SignerChanged(address indexed signer);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event BaseURIChanged(string baseURI);

    error NotOwner();
    error BadBadge();
    error Expired();
    error BadSignature();
    error AlreadyClaimed();
    error Soulbound();
    error NoSuchToken();
    error ZeroAddress();

    constructor(address signer_, address owner_, string memory baseURI_) {
        if (signer_ == address(0) || owner_ == address(0)) revert ZeroAddress();
        signer = signer_;
        owner = owner_;
        baseURI = baseURI_;
        emit OwnershipTransferred(address(0), owner_);
        emit SignerChanged(signer_);
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    // ------------------------------------------------------------------ mint --

    /// The token id of `badge` held by `holder`: badge number in the high bits, holder below.
    function tokenIdFor(address holder, uint8 badge) public pure returns (uint256) {
        return (uint256(badge) << 160) | uint256(uint160(holder));
    }

    /// The message the game server signs (EIP-191 personal_sign over this hash).
    function voucherHash(address holder, uint8 badge, uint256 deadline) public view returns (bytes32) {
        return keccak256(abi.encode(block.chainid, address(this), holder, badge, deadline));
    }

    function claim(uint8 badge, uint256 deadline, bytes calldata signature) external {
        if (badge == 0) revert BadBadge();
        if (block.timestamp > deadline) revert Expired();
        uint256 bit = uint256(1) << badge;
        if (badgesOf[msg.sender] & bit != 0) revert AlreadyClaimed();

        bytes32 digest = keccak256(
            abi.encodePacked("\x19Ethereum Signed Message:\n32", voucherHash(msg.sender, badge, deadline))
        );
        if (_recover(digest, signature) != signer) revert BadSignature();

        badgesOf[msg.sender] |= bit;
        uint256 id = tokenIdFor(msg.sender, badge);
        _ownerOf[id] = msg.sender;
        unchecked {
            _balanceOf[msg.sender] += 1;
            totalSupply += 1;
        }
        emit Transfer(address(0), msg.sender, id);
        emit Locked(id);
    }

    function _recover(bytes32 digest, bytes calldata signature) private pure returns (address) {
        if (signature.length != 65) return address(0);
        bytes32 r = bytes32(signature[0:32]);
        bytes32 s = bytes32(signature[32:64]);
        uint8 v = uint8(signature[64]);
        if (v < 27) v += 27;
        // Reject malleable signatures (upper-half s), as OpenZeppelin's ECDSA does.
        if (uint256(s) > 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0) return address(0);
        if (v != 27 && v != 28) return address(0);
        return ecrecover(digest, v, r, s);
    }

    // ----------------------------------------------------------------- admin --

    function setSigner(address signer_) external onlyOwner {
        if (signer_ == address(0)) revert ZeroAddress();
        signer = signer_;
        emit SignerChanged(signer_);
    }

    function setBaseURI(string calldata baseURI_) external onlyOwner {
        baseURI = baseURI_;
        emit BaseURIChanged(baseURI_);
    }

    function transferOwnership(address owner_) external onlyOwner {
        if (owner_ == address(0)) revert ZeroAddress();
        emit OwnershipTransferred(owner, owner_);
        owner = owner_;
    }

    // ---------------------------------------------------------------- ERC-721 --

    function balanceOf(address holder) external view returns (uint256) {
        if (holder == address(0)) revert ZeroAddress();
        return _balanceOf[holder];
    }

    function ownerOf(uint256 id) public view returns (address holder) {
        holder = _ownerOf[id];
        if (holder == address(0)) revert NoSuchToken();
    }

    function tokenURI(uint256 id) external view returns (string memory) {
        ownerOf(id);
        return string.concat(baseURI, _toString(id));
    }

    /// ERC-5192: every badge is locked to its holder for good.
    function locked(uint256 id) external view returns (bool) {
        ownerOf(id);
        return true;
    }

    function getApproved(uint256 id) external view returns (address) {
        ownerOf(id);
        return address(0);
    }

    function isApprovedForAll(address, address) external pure returns (bool) {
        return false;
    }

    function approve(address, uint256) external pure {
        revert Soulbound();
    }

    function setApprovalForAll(address, bool) external pure {
        revert Soulbound();
    }

    function transferFrom(address, address, uint256) external pure {
        revert Soulbound();
    }

    function safeTransferFrom(address, address, uint256) external pure {
        revert Soulbound();
    }

    function safeTransferFrom(address, address, uint256, bytes calldata) external pure {
        revert Soulbound();
    }

    function supportsInterface(bytes4 id) external pure returns (bool) {
        return
            id == 0x01ffc9a7 || // ERC-165
            id == 0x80ac58cd || // ERC-721
            id == 0x5b5e139f || // ERC-721 Metadata
            id == 0xb45a3c0e; // ERC-5192 (soulbound)
    }

    function _toString(uint256 value) private pure returns (string memory out) {
        if (value == 0) return "0";
        uint256 digits;
        for (uint256 v = value; v != 0; v /= 10) digits++;
        bytes memory buffer = new bytes(digits);
        while (value != 0) {
            digits -= 1;
            buffer[digits] = bytes1(uint8(48 + (value % 10)));
            value /= 10;
        }
        out = string(buffer);
    }
}
