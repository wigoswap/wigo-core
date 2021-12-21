// SPDX-License-Identifier: MIT
pragma solidity 0.6.12;

import "../WigoswapERC20.sol";

contract ERC20 is WigoswapERC20 {
    constructor(uint256 _totalSupply) public {
        _mint(msg.sender, _totalSupply);
    }
}
