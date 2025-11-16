const express = require('express');
const router = express.Router();
const Store = require('../models/Store');

// Get all stores
router.get('/', async (req, res) => {
  try {
    const stores = await Store.find({ isActive: true })
      .sort({ lastAccessAt: -1 })
      .select('-accessToken'); // Don't expose access tokens
    
    res.json({
      count: stores.length,
      stores: stores,
    });
  } catch (error) {
    console.error('Error fetching stores:', error);
    res.status(500).json({ error: 'Failed to fetch stores' });
  }
});

// Get a specific store by shop domain
router.get('/:shop', async (req, res) => {
  try {
    const store = await Store.findOne({ shop: req.params.shop })
      .select('-accessToken'); // Don't expose access token
    
    if (!store) {
      return res.status(404).json({ error: 'Store not found' });
    }
    
    // Return store with all shopData fields
    res.json({
      ...store.toObject(),
      shopDataFields: store.shopData ? Object.keys(store.shopData).length : 0,
    });
  } catch (error) {
    console.error('Error fetching store:', error);
    res.status(500).json({ error: 'Failed to fetch store' });
  }
});

// Get store statistics
router.get('/stats/summary', async (req, res) => {
  try {
    const totalStores = await Store.countDocuments();
    const activeStores = await Store.countDocuments({ isActive: true });
    const uninstalledStores = await Store.countDocuments({ isActive: false });
    
    res.json({
      total: totalStores,
      active: activeStores,
      uninstalled: uninstalledStores,
    });
  } catch (error) {
    console.error('Error fetching store stats:', error);
    res.status(500).json({ error: 'Failed to fetch store statistics' });
  }
});

module.exports = router;

