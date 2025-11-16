const express = require('express');
const router = express.Router();
const Product = require('../models/Product');

// Get all products for a shop
router.get('/', async (req, res) => {
  try {
    const shop = req.query.shop;
    
    if (!shop) {
      return res.status(400).json({ error: 'Shop parameter is required' });
    }

    const products = await Product.find({ shop: shop })
      .sort({ syncedAt: -1 })
      .select('-productData.variants'); // Exclude full variant data for list view
    
    res.json({
      count: products.length,
      shop: shop,
      products: products,
    });
  } catch (error) {
    console.error('Error fetching products:', error);
    res.status(500).json({ error: 'Failed to fetch products' });
  }
});

// Get a specific product by ID
router.get('/:productId', async (req, res) => {
  try {
    const shop = req.query.shop;
    const productId = parseInt(req.params.productId);
    
    if (!shop) {
      return res.status(400).json({ error: 'Shop parameter is required' });
    }

    const product = await Product.findOne({ 
      shop: shop, 
      shopifyProductId: productId 
    });
    
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }
    
    res.json(product);
  } catch (error) {
    console.error('Error fetching product:', error);
    res.status(500).json({ error: 'Failed to fetch product' });
  }
});

// Search products
router.get('/search/:query', async (req, res) => {
  try {
    const shop = req.query.shop;
    const searchQuery = req.params.query;
    
    if (!shop) {
      return res.status(400).json({ error: 'Shop parameter is required' });
    }

    const products = await Product.find({
      shop: shop,
      $text: { $search: searchQuery }
    })
    .sort({ score: { $meta: 'textScore' } })
    .limit(50);
    
    res.json({
      count: products.length,
      query: searchQuery,
      products: products,
    });
  } catch (error) {
    console.error('Error searching products:', error);
    res.status(500).json({ error: 'Failed to search products' });
  }
});

// Get product statistics
router.get('/stats/summary', async (req, res) => {
  try {
    const shop = req.query.shop;
    
    if (!shop) {
      return res.status(400).json({ error: 'Shop parameter is required' });
    }

    const totalProducts = await Product.countDocuments({ shop: shop });
    const activeProducts = await Product.countDocuments({ 
      shop: shop, 
      status: 'active' 
    });
    const archivedProducts = await Product.countDocuments({ 
      shop: shop, 
      status: 'archived' 
    });
    
    res.json({
      shop: shop,
      total: totalProducts,
      active: activeProducts,
      archived: archivedProducts,
    });
  } catch (error) {
    console.error('Error fetching product stats:', error);
    res.status(500).json({ error: 'Failed to fetch product statistics' });
  }
});

module.exports = router;

