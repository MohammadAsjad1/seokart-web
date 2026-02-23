const backlinkService = require('../services/backlinkService');

/**
 * Get paginated backlink data for dashboard
 * @route GET /api/backlinks/dashboard
 * @access Private (requires authentication)
 */
const getBacklinkDataForDashboard = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?._id;
    
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'User authentication required'
      });
    }

    const {
      websiteUrl,
      page,
      limit,
      query,
      firstSeenFromDate,
      firstSeenToDate,
      lastSeenFromDate,
      lastSeenToDate,
      sortBy,
      minDomainScore,
      maxDomainScore,
      linkTypes,
      anchorText
    } = req.query;

    if (!websiteUrl || typeof websiteUrl !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'websiteUrl is required'
      });
    }

    const trimmedUrl = websiteUrl.trim();
    if (trimmedUrl.length < 3) {
      return res.status(400).json({
        success: false,
        message: 'websiteUrl must be at least 3 characters long'
      });
    }

    // Validate dates
    if (firstSeenFromDate && isNaN(new Date(firstSeenFromDate).getTime())) {
      return res.status(400).json({
        success: false,
        message: 'Invalid firstSeenFromDate format'
      });
    }

    if (firstSeenToDate && isNaN(new Date(firstSeenToDate).getTime())) {
      return res.status(400).json({
        success: false,
        message: 'Invalid firstSeenToDate format'
      });
    }

    if (lastSeenFromDate && isNaN(new Date(lastSeenFromDate).getTime())) {
      return res.status(400).json({
        success: false,
        message: 'Invalid lastSeenFromDate format'
      });
    }

    if (lastSeenToDate && isNaN(new Date(lastSeenToDate).getTime())) {
      return res.status(400).json({
        success: false,
        message: 'Invalid lastSeenToDate format'
      });
    }

    // Validate domain score range
    if (minDomainScore && (isNaN(minDomainScore) || minDomainScore < 0 || minDomainScore > 100)) {
      return res.status(400).json({
        success: false,
        message: 'minDomainScore must be between 0 and 100'
      });
    }

    if (maxDomainScore && (isNaN(maxDomainScore) || maxDomainScore < 0 || maxDomainScore > 100)) {
      return res.status(400).json({
        success: false,
        message: 'maxDomainScore must be between 0 and 100'
      });
    }

    // Parse link types array
    let parsedLinkTypes = [];
    if (linkTypes) {
      if (typeof linkTypes === 'string') {
        parsedLinkTypes = linkTypes.split(',').map(t => t.trim().toLowerCase());
      } else if (Array.isArray(linkTypes)) {
        parsedLinkTypes = linkTypes.map(t => String(t).trim().toLowerCase());
      }
      
      const validTypes = ['dofollow', 'nofollow'];
      parsedLinkTypes = parsedLinkTypes.filter(t => validTypes.includes(t));
    }

    const options = {
      websiteUrl: trimmedUrl,
      page: page ? parseInt(page) : 1,
      limit: limit ? parseInt(limit) : 10,
      query: query ? query.trim() : '',
      firstSeenFromDate,
      firstSeenToDate,
      lastSeenFromDate,
      lastSeenToDate,
      sortBy: sortBy || 'inlink_rank',
      minDomainScore: minDomainScore ? parseInt(minDomainScore) : undefined,
      maxDomainScore: maxDomainScore ? parseInt(maxDomainScore) : undefined,
      linkTypes: parsedLinkTypes,
      anchorText: anchorText ? anchorText.trim() : ''
    };

    if (isNaN(options.page) || options.page < 1) {
      return res.status(400).json({
        success: false,
        message: 'Page must be a positive integer'
      });
    }

    if (isNaN(options.limit) || options.limit < 1 || options.limit > 100) {
      return res.status(400).json({
        success: false,
        message: 'Limit must be between 1 and 100'
      });
    }

    const result = await backlinkService.getBacklinkDataForDashboard(userId, options);

    if (!result.success) {
      return res.status(result.statusCode || 500).json({
        success: false,
        message: result.error || 'Failed to fetch backlink data'
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Backlink data retrieved successfully',
      data: result.data
    });

  } catch (error) {
    console.error('[BACKLINK-CONTROLLER] Error:', error.message);
    
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

module.exports = {
  getBacklinkDataForDashboard
};