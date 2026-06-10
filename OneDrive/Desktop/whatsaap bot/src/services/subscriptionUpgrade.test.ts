/**
 * Tests for Subscription Upgrade Functionality (Task 4.4)
 */

import * as subscriptionModule from '../services/subscriptionService';

describe('Subscription Upgrade (Task 4.4)', () => {
  describe('getSubscriptionPlans', () => {
    it('should return all subscription plans', () => {
      const plans = subscriptionModule.SUBSCRIPTION_TIERS;
      expect(Object.keys(plans)).toHaveLength(3);
      expect(plans.free.id).toBe('plan_free');
      expect(plans.pro.id).toBe('plan_pro');
      expect(plans.enterprise.id).toBe('plan_enterprise');
    });

    it('should have correct pricing for each tier', () => {
      const tiers = subscriptionModule.SUBSCRIPTION_TIERS;
      expect(tiers.free.price).toBe(0);
      expect(tiers.pro.price).toBe(999);
      expect(tiers.enterprise.price).toBe(4999);
    });

    it('should have correct features for each tier', () => {
      const tiers = subscriptionModule.SUBSCRIPTION_TIERS;
      
      expect(tiers.free.features.maxBots).toBe(1);
      expect(tiers.free.features.messagesPerMonth).toBe(1000);
      
      expect(tiers.pro.features.maxBots).toBe(10);
      expect(tiers.pro.features.messagesPerMonth).toBe(100000);
      
      expect(tiers.enterprise.features.maxBots).toBe(100);
      expect(tiers.enterprise.features.messagesPerMonth).toBe(10000000);
    });
  });

  describe('Plan validation', () => {
    it('should export getSubscriptionPlans function', () => {
      expect(typeof subscriptionModule.getSubscriptionPlans).toBe('function');
    });

    it('should export upgradeSubscriptionToNewPlan function', () => {
      expect(typeof subscriptionModule.upgradeSubscriptionToNewPlan).toBe('function');
    });

    it('should export getUserCurrentSubscription function', () => {
      expect(typeof subscriptionModule.getUserCurrentSubscription).toBe('function');
    });

    it('should export getPaymentHistory function', () => {
      expect(typeof subscriptionModule.getPaymentHistory).toBe('function');
    });
  });
});

