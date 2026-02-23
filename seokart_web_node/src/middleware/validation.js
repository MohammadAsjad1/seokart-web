const { body, query, validationResult } = require('express-validator');

const validateAddKeywords = [
  body('keywords')
    .isArray({ min: 1 })
    .withMessage('Keywords must be an array with at least one item'),
  body('keywords.*')
    .isString()
    .trim()
    .isLength({ min: 1, max: 200 }) 
    .withMessage('Each keyword must be between 1 and 200 characters'),
  body('targetDomain')
    .isString()
    .trim()
    .isLength({ min: 1 })
    .withMessage('Target domain is required'),
  body('location')
    .isString()
    .trim()
    .isLength({ min: 1 })
    .withMessage('Location is required'),
  body('device')
    .isIn(['desktop', 'mobile', 'tablet'])
    .withMessage('Device must be desktop, mobile, or tablet'),
  body('language')
    .optional()
    .isString()
    .trim()
    .isLength({ min: 2, max: 5 })
    .withMessage('Language must be a valid language code'),
  body('searchEngine')
    .optional()
    .isIn(['google', 'bing', 'yahoo'])
    .withMessage('Search engine must be google, bing, or yahoo'),
  body('frequency')
    .optional()
    .isIn(['monthly'])
    .withMessage('Frequency must be monthly')
];

const validateAddCompetitors = [
  body('competitors')
    .isArray({ min: 1 })
    .withMessage('Competitors must be an array with at least one item'),
  body('competitors.*.domain')
    .isString()
    .trim()
    .isLength({ min: 1 })
    .withMessage('Competitor domain is required'),
  body('competitors.*.name')
    .optional()
    .isString()
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage('Competitor name must be between 1 and 100 characters'),
  body('competitors.*.group')
    .optional()
    .isIn(['primary', 'secondary', 'indirect'])
    .withMessage('Competitor group must be primary, secondary, or indirect')
];

const validatePagination = [
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be a positive integer'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100')
];

const validateKeywordSuggestions = [
  query('seed')
    .isString()
    .trim()
    .isLength({ min: 1, max: 200 })
    .withMessage('Seed keyword is required and must be between 1 and 200 characters'),
  query('location')
    .optional()
    .isString()
    .trim()
    .isLength({ min: 1 })
    .withMessage('Location must be provided'),
  query('language')
    .optional()
    .isString()
    .trim()
    .isLength({ min: 2, max: 5 })
    .withMessage('Language must be a valid language code')
];

const validateCompetitorSuggestions = [
  query('targetDomain')
    .isString()
    .trim()
    .isLength({ min: 1 })
    .withMessage('Target domain is required'),
  query('keywords')
    .optional()
    .isString()
    .withMessage('Keywords must be a comma-separated string'),
  query('location')
    .optional()
    .isString()
    .trim()
    .isLength({ min: 1 })
    .withMessage('Location must be provided')
];

const validateRefreshRankings = [
  body('keywordIds')
    .isArray({ min: 1 })
    .withMessage('Keyword IDs must be an array with at least one item'),
  body('keywordIds.*')
    .isMongoId()
    .withMessage('Each keyword ID must be a valid MongoDB ObjectId'),
  body('priority')
    .optional()
    .isInt({ min: 1, max: 5 })
    .withMessage('Priority must be between 1 and 5')
];

const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array()
    });
  }
  next();
};

module.exports = {
  validateAddKeywords,
  validateAddCompetitors,
  validatePagination,
  validateKeywordSuggestions,
  validateCompetitorSuggestions,
  validateRefreshRankings,
  handleValidationErrors
};