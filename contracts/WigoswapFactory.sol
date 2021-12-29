// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "./interfaces/IWigoswapFactory.sol";
import "./WigoswapPair.sol";

contract WigoswapFactory is IWigoswapFactory {
    bytes32 public constant INIT_CODE_PAIR_HASH =
        keccak256(abi.encodePacked(type(WigoswapPair).creationCode));
    address public override feeTo;
    address public override feeToSetter;

    mapping(address => mapping(address => address)) public override getPair;
    address[] public override allPairs;

    event SetFeeTo(address indexed sender, address indexed feeTo);
    event SetFeeToSetter(address indexed sender, address indexed feeToSetter);

    event PairCreated(
        address indexed token0,
        address indexed token1,
        address pair,
        uint256
    );

    constructor(address _feeToSetter) public {
        feeToSetter = _feeToSetter;
    }

    function allPairsLength() external view override returns (uint256) {
        return allPairs.length;
    }

    function pairCodeHash() external pure returns (bytes32) {
        return keccak256(type(WigoswapPair).creationCode);
    }

    function createPair(address tokenA, address tokenB)
        external
        override
        returns (address pair)
    {
        require(tokenA != tokenB, "Wigoswap: IDENTICAL_ADDRESSES");
        (address token0, address token1) = tokenA < tokenB
            ? (tokenA, tokenB)
            : (tokenB, tokenA);
        require(token0 != address(0), "Wigoswap: ZERO_ADDRESS");
        require(getPair[token0][token1] == address(0), "Wigoswap: PAIR_EXISTS"); // single check is sufficient
        bytes memory bytecode = type(WigoswapPair).creationCode;
        bytes32 salt = keccak256(abi.encodePacked(token0, token1));
        assembly {
            pair := create2(0, add(bytecode, 32), mload(bytecode), salt)
        }
        WigoswapPair(pair).initialize(token0, token1);
        getPair[token0][token1] = pair;
        getPair[token1][token0] = pair; // populate mapping in the reverse direction
        allPairs.push(pair);
        emit PairCreated(token0, token1, pair, allPairs.length);
    }

    function setFeeTo(address _feeTo) external override {
        require(msg.sender == feeToSetter, "Wigoswap: FORBIDDEN");
        feeTo = _feeTo;
        emit SetFeeTo(msg.sender, _feeTo);
    }

    function setFeeToSetter(address _feeToSetter) external override {
        require(msg.sender == feeToSetter, "Wigoswap: FORBIDDEN");
        feeToSetter = _feeToSetter;
        emit SetFeeToSetter(msg.sender, _feeToSetter);
    }
}
