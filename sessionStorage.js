// MongoDB session storage for Shopify sessions

const Session = require('./models/Session');

class SessionStorage {
  async storeSession(session) {
    try {
      // Store the full session object as sessionData for proper deserialization
      // Also store individual fields for querying
      const sessionData = {
        id: session.id,
        shop: session.shop,
        state: session.state,
        isOnline: session.isOnline || false,
        scope: session.scope,
        expires: session.expires,
        accessToken: session.accessToken,
        userId: session.userId,
        // Store the complete session object - this is what Shopify API expects
        sessionData: JSON.parse(JSON.stringify(session)), // Deep clone to ensure proper serialization
      };

      console.log('Attempting to store session in MongoDB:', {
        id: session.id,
        shop: session.shop,
        hasAccessToken: !!session.accessToken,
      });

      const result = await Session.findOneAndUpdate(
        { id: session.id },
        sessionData,
        { upsert: true, new: true }
      );

      console.log('Session stored in MongoDB:', {
        id: session.id,
        shop: session.shop,
        hasAccessToken: !!session.accessToken,
        stored: !!result,
        resultId: result?.id,
      });

      return true;
    } catch (error) {
      console.error('Error storing session:', error);
      throw error;
    }
  }

  async loadSession(id) {
    try {
      const sessionDoc = await Session.findOne({ id });
      
      if (!sessionDoc) {
        console.log('Session not found in database:', id);
        return undefined;
      }

      // Prefer sessionData if it exists (full session object)
      // Otherwise reconstruct from individual fields
      let session = sessionDoc.sessionData;
      
      if (!session) {
        // Fallback: reconstruct session from individual fields
        session = {
          id: sessionDoc.id,
          shop: sessionDoc.shop,
          state: sessionDoc.state,
          isOnline: sessionDoc.isOnline,
          scope: sessionDoc.scope,
          expires: sessionDoc.expires,
          accessToken: sessionDoc.accessToken,
          userId: sessionDoc.userId,
        };
      }

      // Ensure session has all required fields
      if (!session.id) session.id = sessionDoc.id;
      if (!session.shop) session.shop = sessionDoc.shop;
      if (!session.accessToken && sessionDoc.accessToken) {
        session.accessToken = sessionDoc.accessToken;
      }

      console.log('Session loaded:', {
        id: session.id,
        shop: session.shop,
        hasAccessToken: !!session.accessToken,
        fromSessionData: !!sessionDoc.sessionData,
      });

      return session;
    } catch (error) {
      console.error('Error loading session:', error);
      return undefined;
    }
  }

  async deleteSession(id) {
    try {
      await Session.deleteOne({ id });
      return true;
    } catch (error) {
      console.error('Error deleting session:', error);
      throw error;
    }
  }

  async deleteSessions(ids) {
    try {
      await Session.deleteMany({ id: { $in: ids } });
      return true;
    } catch (error) {
      console.error('Error deleting sessions:', error);
      throw error;
    }
  }

  // Additional helper methods
  async findSessionsByShop(shop) {
    try {
      const sessions = await Session.find({ shop });
      return sessions.map(s => s.sessionData || s.toObject());
    } catch (error) {
      console.error('Error finding sessions by shop:', error);
      return [];
    }
  }

  async deleteSessionsByShop(shop) {
    try {
      await Session.deleteMany({ shop });
      return true;
    } catch (error) {
      console.error('Error deleting sessions by shop:', error);
      throw error;
    }
  }
}

module.exports = SessionStorage;
