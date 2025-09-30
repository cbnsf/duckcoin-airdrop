import { Connection, PublicKey, Keypair, Transaction } from '@solana/web3.js';
import { getOrCreateAssociatedTokenAccount, createTransferInstruction, TOKEN_PROGRAM_ID, getAssociatedTokenAddress } from '@solana/spl-token';

// 使用环境变量
const PRIVATE_KEY = JSON.parse(process.env.WALLET_PRIVATE_KEY);
const TOKEN_MINT_ADDRESS = process.env.TOKEN_MINT_ADDRESS;
const RPC_URL = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';

const connection = new Connection(RPC_URL, 'confirmed');
const wallet = Keypair.fromSecretKey(new Uint8Array(PRIVATE_KEY));

// 存储已领取空投的地址（生产环境应该用数据库）
const claimedAddresses = new Set();

export default async function handler(req, res) {
  // 设置CORS头
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { walletAddress } = req.body;

    if (!walletAddress) {
      return res.status(400).json({ error: 'Wallet address is required' });
    }

    // 验证钱包地址格式
    try {
      new PublicKey(walletAddress);
    } catch (error) {
      return res.status(400).json({ error: 'Invalid wallet address' });
    }

    // 检查是否已经领取过
    if (claimedAddresses.has(walletAddress)) {
      return res.status(400).json({ error: 'Airdrop already claimed for this wallet' });
    }

    const recipient = new PublicKey(walletAddress);
    const mint = new PublicKey(TOKEN_MINT_ADDRESS);

    // 获取发送者的代币账户
    const fromTokenAccount = await getAssociatedTokenAddress(mint, wallet.publicKey);
    
    // 获取或创建接收者的代币账户
    const toTokenAccount = await getAssociatedTokenAddress(mint, recipient);
    
    // 检查接收者代币账户是否存在，如果不存在需要创建
    let toTokenAccountInfo;
    try {
      toTokenAccountInfo = await connection.getAccountInfo(toTokenAccount);
    } catch (error) {
      console.log('Error checking token account:', error);
    }

    const transaction = new Transaction();

    // 如果接收者没有代币账户，需要创建
    if (!toTokenAccountInfo) {
      transaction.add(
        await createAssociatedTokenAccountInstruction(
          recipient,
          toTokenAccount,
          mint
        )
      );
    }

    // 添加转账指令 (25000个代币，假设代币有6位小数)
    const transferAmount = 25000 * Math.pow(10, 6); // 根据你的代币小数位数调整

    transaction.add(
      createTransferInstruction(
        fromTokenAccount,
        toTokenAccount,
        wallet.publicKey,
        transferAmount,
        [],
        TOKEN_PROGRAM_ID
      )
    );

    // 设置最新的区块哈希
    const { blockhash } = await connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = wallet.publicKey;

    // 签名并发送交易
    transaction.sign(wallet);
    const signature = await connection.sendRawTransaction(transaction.serialize());
    
    // 确认交易
    await connection.confirmTransaction(signature, 'confirmed');

    // 记录已领取的地址
    claimedAddresses.add(walletAddress);

    res.status(200).json({
      success: true,
      signature,
      message: '25000 DUCK tokens sent successfully!'
    });

  } catch (error) {
    console.error('Airdrop error:', error);
    res.status(500).json({ 
      error: 'Failed to process airdrop',
      details: error.message 
    });
  }
}

// 创建关联代币账户的指令
async function createAssociatedTokenAccountInstruction(owner, associatedToken, mint) {
  const { createAssociatedTokenAccountInstruction } = await import('@solana/spl-token');
  return createAssociatedTokenAccountInstruction(
    wallet.publicKey,
    associatedToken,
    owner,
    mint
  );
}