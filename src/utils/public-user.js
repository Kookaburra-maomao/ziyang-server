function publicUser(user) {
  const profileCompleted = Boolean(user.profile_completed);
  const identityType = user.identity_type ? Number(user.identity_type) : null;
  return {
    id: user.id,
    username: user.username || null,
    phone: user.phone || null,
    profileCompleted,
    needsProfileSetup: !profileCompleted,
    identityType,
    pendingIdentityType: user.pending_identity_type ? Number(user.pending_identity_type) : null,
    realName: user.real_name || null,
    address: user.address || null,
    sensitiveConsentAt: user.sensitive_consent_at || null,
    identityCompleted: Boolean(identityType && user.identity_completed_at),
    needsIdentitySetup: !identityType,
    createdAt: user.created_at,
  };
}

module.exports = { publicUser };
