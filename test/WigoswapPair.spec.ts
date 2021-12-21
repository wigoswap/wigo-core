import { expect } from "chai"
import { BigNumber, constants as ethconst, Wallet } from "ethers"
import { ethers, waffle } from "hardhat"

import { expandTo18Decimals, encodePrice, setNextBlockTime } from "./shared/utilities"
import { WigoswapFactory, WigoswapPair, ERC20 } from "../types"
import { MockProvider } from "@ethereum-waffle/provider"

const MINIMUM_LIQUIDITY = BigNumber.from(10).pow(3)

describe("WigoswapPair", () => {
  const loadFixture = waffle.createFixtureLoader(waffle.provider.getWallets(), waffle.provider)

  async function fixture([wallet, other]: Wallet[], provider: MockProvider) {
    const factory = (await (await ethers.getContractFactory("WigoswapFactory")).deploy(wallet.address)) as WigoswapFactory

    const tokenA = (await (await ethers.getContractFactory("ERC20")).deploy(expandTo18Decimals(10000))) as ERC20
    const tokenB = (await (await ethers.getContractFactory("ERC20")).deploy(expandTo18Decimals(10000))) as ERC20

    await factory.createPair(tokenA.address, tokenB.address)
    const pair = (await ethers.getContractFactory("WigoswapPair")).attach(await factory.getPair(tokenA.address, tokenB.address)) as WigoswapPair
    const token0Address = await pair.token0()
    const token0 = tokenA.address === token0Address ? tokenA : tokenB
    const token1 = tokenA.address === token0Address ? tokenB : tokenA
    return { pair, token0, token1, wallet, other, factory, provider }
  }

  it("mint", async () => {
    const { pair, wallet, token0, token1 } = await loadFixture(fixture)
    const token0Amount = expandTo18Decimals(1)
    const token1Amount = expandTo18Decimals(4)
    await token0.transfer(pair.address, token0Amount)
    await token1.transfer(pair.address, token1Amount)

    const expectedLiquidity = expandTo18Decimals(2)
    await expect(pair.mint(wallet.address))
      .to.emit(pair, "Transfer")
      .withArgs(ethconst.AddressZero, ethconst.AddressZero, MINIMUM_LIQUIDITY)
      .to.emit(pair, "Transfer")
      .withArgs(ethconst.AddressZero, wallet.address, expectedLiquidity.sub(MINIMUM_LIQUIDITY))
      .to.emit(pair, "Sync")
      .withArgs(token0Amount, token1Amount)
      .to.emit(pair, "Mint")
      .withArgs(wallet.address, token0Amount, token1Amount)

    expect(await pair.totalSupply()).to.eq(expectedLiquidity)
    expect(await pair.balanceOf(wallet.address)).to.eq(expectedLiquidity.sub(MINIMUM_LIQUIDITY))
    expect(await token0.balanceOf(pair.address)).to.eq(token0Amount)
    expect(await token1.balanceOf(pair.address)).to.eq(token1Amount)
    const reserves = await pair.getReserves()
    expect(reserves[0]).to.eq(token0Amount)
    expect(reserves[1]).to.eq(token1Amount)
  })

  async function addLiquidity(
    token0: ERC20,
    token1: ERC20,
    pair: WigoswapPair,
    wallet: Wallet,
    token0Amount: BigNumber,
    token1Amount: BigNumber
  ) {
    await token0.transfer(pair.address, token0Amount)
    await token1.transfer(pair.address, token1Amount)
    await pair.mint(wallet.address)
  }
  const swapTestCases: BigNumber[][] = [
    [1, 5, 10, "1664026941864923892"], // [10 / (5 + 1 * .9981)] *( 1 * .9981)
    [1, 10, 5, "453760194942762840"],

    [2, 5, 10, "2853263200022869557"],
    [2, 10, 5, "832013470932461946"],

    [1, 10, 10, "907520389885525681"],
    [1, 100, 100, "988236412368153460"],
    [1, 1000, 1000, "997104789709391056"],
  ].map((a) => a.map((n) => (typeof n === "string" ? BigNumber.from(n) : expandTo18Decimals(n))))
  swapTestCases.forEach((swapTestCase, i) => {
    it(`getInputPrice:${i}`, async () => {
      const { pair, wallet, token0, token1, other } = await loadFixture(fixture)

      const [swapAmount, token0Amount, token1Amount, expectedOutputAmount] = swapTestCase
      await addLiquidity(token0, token1, pair, wallet, token0Amount, token1Amount)
      await token0.transfer(pair.address, swapAmount)
      await expect(pair.swap(0, expectedOutputAmount.add(1), wallet.address, "0x")).to.be.revertedWith("Wigoswap: K")
      await pair.swap(0, expectedOutputAmount, wallet.address, "0x")
    })
  })

  const optimisticTestCases: BigNumber[][] = [
    ["998100000000000000", 5, 10, 1], // given amountIn, amountOut = floor(amountIn * .9981)
    ["998100000000000000", 10, 5, 1],
    ["998100000000000000", 5, 5, 1],
    [1, 5, 5, "1001903616872056909"], // given amountOut, amountIn = ceiling(amountOut / .9981)
  ].map((a) => a.map((n) => (typeof n === "string" ? BigNumber.from(n) : expandTo18Decimals(n))))
  optimisticTestCases.forEach((optimisticTestCase, i) => {
    it(`optimistic:${i}`, async () => {
      const { pair, wallet, token0, token1 } = await loadFixture(fixture)

      const [outputAmount, token0Amount, token1Amount, inputAmount] = optimisticTestCase
      await addLiquidity(token0, token1, pair, wallet, token0Amount, token1Amount)
      await token0.transfer(pair.address, inputAmount)
      await expect(pair.swap(outputAmount.add(1), 0, wallet.address, "0x")).to.be.revertedWith("Wigoswap: K")
      await pair.swap(outputAmount, 0, wallet.address, "0x")
    })
  })

  it("swap:token0", async () => {
    const { pair, wallet, token0, token1, other } = await loadFixture(fixture)

    const token0Amount = expandTo18Decimals(5)
    const token1Amount = expandTo18Decimals(10)
    await addLiquidity(token0, token1, pair, wallet, token0Amount, token1Amount)

    const swapAmount = expandTo18Decimals(1)
    const expectedOutputAmount = BigNumber.from("1662497915624478906")
    await token0.transfer(pair.address, swapAmount)
    await expect(pair.swap(0, expectedOutputAmount, wallet.address, "0x"))
      .to.emit(token1, "Transfer")
      .withArgs(pair.address, wallet.address, expectedOutputAmount)
      .to.emit(pair, "Sync")
      .withArgs(token0Amount.add(swapAmount), token1Amount.sub(expectedOutputAmount))
      .to.emit(pair, "Swap")
      .withArgs(wallet.address, swapAmount, 0, 0, expectedOutputAmount, wallet.address)

    const reserves = await pair.getReserves()
    expect(reserves[0]).to.eq(token0Amount.add(swapAmount))
    expect(reserves[1]).to.eq(token1Amount.sub(expectedOutputAmount))
    expect(await token0.balanceOf(pair.address)).to.eq(token0Amount.add(swapAmount))
    expect(await token1.balanceOf(pair.address)).to.eq(token1Amount.sub(expectedOutputAmount))
    const totalSupplyToken0 = await token0.totalSupply()
    const totalSupplyToken1 = await token1.totalSupply()
    expect(await token0.balanceOf(wallet.address)).to.eq(totalSupplyToken0.sub(token0Amount).sub(swapAmount))
    expect(await token1.balanceOf(wallet.address)).to.eq(totalSupplyToken1.sub(token1Amount).add(expectedOutputAmount))
  })

  it("swap:token1", async () => {
    const { pair, wallet, token0, token1 } = await loadFixture(fixture)

    const token0Amount = expandTo18Decimals(5)
    const token1Amount = expandTo18Decimals(10)
    await addLiquidity(token0, token1, pair, wallet, token0Amount, token1Amount)

    const swapAmount = expandTo18Decimals(1)
    const expectedOutputAmount = BigNumber.from("453305446940074565")
    await token1.transfer(pair.address, swapAmount)
    await expect(pair.swap(expectedOutputAmount, 0, wallet.address, "0x"))
      .to.emit(token0, "Transfer")
      .withArgs(pair.address, wallet.address, expectedOutputAmount)
      .to.emit(pair, "Sync")
      .withArgs(token0Amount.sub(expectedOutputAmount), token1Amount.add(swapAmount))
      .to.emit(pair, "Swap")
      .withArgs(wallet.address, 0, swapAmount, expectedOutputAmount, 0, wallet.address)

    const reserves = await pair.getReserves()
    expect(reserves[0]).to.eq(token0Amount.sub(expectedOutputAmount))
    expect(reserves[1]).to.eq(token1Amount.add(swapAmount))
    expect(await token0.balanceOf(pair.address)).to.eq(token0Amount.sub(expectedOutputAmount))
    expect(await token1.balanceOf(pair.address)).to.eq(token1Amount.add(swapAmount))
    const totalSupplyToken0 = await token0.totalSupply()
    const totalSupplyToken1 = await token1.totalSupply()
    expect(await token0.balanceOf(wallet.address)).to.eq(totalSupplyToken0.sub(token0Amount).add(expectedOutputAmount))
    expect(await token1.balanceOf(wallet.address)).to.eq(totalSupplyToken1.sub(token1Amount).sub(swapAmount))
  })

  it("swap:gas", async () => {
    const { pair, wallet, token0, token1, provider } = await loadFixture(fixture)

    const token0Amount = expandTo18Decimals(5)
    const token1Amount = expandTo18Decimals(10)
    await addLiquidity(token0, token1, pair, wallet, token0Amount, token1Amount)

    // ensure that setting price{0,1}CumulativeLast for the first time doesn't affect our gas math
    await provider.send("evm_mine", [(await provider.getBlock("latest")).timestamp + 1])

    await setNextBlockTime(provider, (await provider.getBlock("latest")).timestamp + 1)
    await pair.sync()

    const swapAmount = expandTo18Decimals(1)
    const expectedOutputAmount = BigNumber.from("453305446940074565")
    await token1.transfer(pair.address, swapAmount)
    await setNextBlockTime(provider, (await provider.getBlock("latest")).timestamp + 1)
    const tx = await pair.swap(expectedOutputAmount, 0, wallet.address, "0x")
    const receipt = await tx.wait()
    expect(receipt.gasUsed).to.eq(73084)
  })

  it("burn", async () => {
    const { pair, wallet, token0, token1 } = await loadFixture(fixture)

    const token0Amount = expandTo18Decimals(3)
    const token1Amount = expandTo18Decimals(3)
    await addLiquidity(token0, token1, pair, wallet, token0Amount, token1Amount)

    const expectedLiquidity = expandTo18Decimals(3)
    await pair.transfer(pair.address, expectedLiquidity.sub(MINIMUM_LIQUIDITY))
    await expect(pair.burn(wallet.address))
      .to.emit(pair, "Transfer")
      .withArgs(pair.address, ethconst.AddressZero, expectedLiquidity.sub(MINIMUM_LIQUIDITY))
      .to.emit(token0, "Transfer")
      .withArgs(pair.address, wallet.address, token0Amount.sub(1000))
      .to.emit(token1, "Transfer")
      .withArgs(pair.address, wallet.address, token1Amount.sub(1000))
      .to.emit(pair, "Sync")
      .withArgs(1000, 1000)
      .to.emit(pair, "Burn")
      .withArgs(wallet.address, token0Amount.sub(1000), token1Amount.sub(1000), wallet.address)

    expect(await pair.balanceOf(wallet.address)).to.eq(0)
    expect(await pair.totalSupply()).to.eq(MINIMUM_LIQUIDITY)
    expect(await token0.balanceOf(pair.address)).to.eq(1000)
    expect(await token1.balanceOf(pair.address)).to.eq(1000)
    const totalSupplyToken0 = await token0.totalSupply()
    const totalSupplyToken1 = await token1.totalSupply()
    expect(await token0.balanceOf(wallet.address)).to.eq(totalSupplyToken0.sub(1000))
    expect(await token1.balanceOf(wallet.address)).to.eq(totalSupplyToken1.sub(1000))
  })

  it("price{0,1}CumulativeLast", async () => {
    const { pair, wallet, token0, token1, provider } = await loadFixture(fixture)

    const token0Amount = expandTo18Decimals(3)
    const token1Amount = expandTo18Decimals(3)
    await addLiquidity(token0, token1, pair, wallet, token0Amount, token1Amount)

    const blockTimestamp = (await pair.getReserves())[2]
    await setNextBlockTime(provider, blockTimestamp + 1)
    await pair.sync()

    const initialPrice = encodePrice(token0Amount, token1Amount)
    // expect(await pair.price0CumulativeLast()).to.eq(initialPrice[0]);
    // expect(await pair.price1CumulativeLast()).to.eq(initialPrice[1]);
    // expect((await pair.getReserves())[2]).to.eq(blockTimestamp + 1);

    const swapAmount = expandTo18Decimals(3)
    await token0.transfer(pair.address, swapAmount)
    await setNextBlockTime(provider, blockTimestamp + 10)
    // swap to a new price eagerly instead of syncing
    await pair.swap(0, expandTo18Decimals(1), wallet.address, "0x") // make the price nice

    expect(await pair.price0CumulativeLast()).to.eq(initialPrice[0].mul(10))
    expect(await pair.price1CumulativeLast()).to.eq(initialPrice[1].mul(10))
    expect((await pair.getReserves())[2]).to.eq(blockTimestamp + 10)

    await setNextBlockTime(provider, blockTimestamp + 20)
    await pair.sync()

    const newPrice = encodePrice(expandTo18Decimals(6), expandTo18Decimals(2))
    expect(await pair.price0CumulativeLast()).to.eq(initialPrice[0].mul(10).add(newPrice[0].mul(10)))
    expect(await pair.price1CumulativeLast()).to.eq(initialPrice[1].mul(10).add(newPrice[1].mul(10)))
    expect((await pair.getReserves())[2]).to.eq(blockTimestamp + 20)
  })

  it("feeTo:off", async () => {
    const { pair, wallet, token0, token1 } = await loadFixture(fixture)

    const token0Amount = expandTo18Decimals(1000)
    const token1Amount = expandTo18Decimals(1000)
    await addLiquidity(token0, token1, pair, wallet, token0Amount, token1Amount)

    const swapAmount = expandTo18Decimals(1)
    const expectedOutputAmount = BigNumber.from("996006981039903216")
    await token1.transfer(pair.address, swapAmount)
    await pair.swap(expectedOutputAmount, 0, wallet.address, "0x")

    const expectedLiquidity = expandTo18Decimals(1000)
    await pair.transfer(pair.address, expectedLiquidity.sub(MINIMUM_LIQUIDITY))
    await pair.burn(wallet.address)
    expect(await pair.totalSupply()).to.eq(MINIMUM_LIQUIDITY)
  })

  it("feeTo:on", async () => {
    const { pair, wallet, token0, token1, other, factory } = await loadFixture(fixture)

    await factory.setFeeTo(other.address)

    const token0Amount = expandTo18Decimals(1000)
    const token1Amount = expandTo18Decimals(1000)
    await addLiquidity(token0, token1, pair, wallet, token0Amount, token1Amount)

    const swapAmount = expandTo18Decimals(1)
    const expectedOutputAmount = BigNumber.from("996006981039903216")
    await token1.transfer(pair.address, swapAmount)
    await pair.swap(expectedOutputAmount, 0, wallet.address, "0x")

    const expectedLiquidity = expandTo18Decimals(1000)
    await pair.transfer(pair.address, expectedLiquidity.sub(MINIMUM_LIQUIDITY))
    await pair.burn(wallet.address)
    expect(await pair.totalSupply()).to.eq(MINIMUM_LIQUIDITY.add("78868565233752"))
    expect(await pair.balanceOf(other.address)).to.eq("78868565233752")

    // using 1000 here instead of the symbolic MINIMUM_LIQUIDITY because the amounts only happen to be equal...
    // ...because the initial liquidity amounts were equal
    expect(await token0.balanceOf(pair.address)).to.eq(BigNumber.from(1000).add("78790005378139"))
    expect(await token1.balanceOf(pair.address)).to.eq(BigNumber.from(1000).add("78947427572517"))
  })
})
