// utils/validation.ts

export interface ValidationError {
  field: string;
  message: string;
}

export interface ValidationResult {
  isValid: boolean;
  errors: ValidationError[];
}

export class KeywordValidator {
  static validateKeywords(keywords: string[]): ValidationResult {
    const errors: ValidationError[] = [];

    if (!keywords || keywords.length === 0) {
      errors.push({
        field: 'keywords',
        message: 'At least one keyword is required'
      });
    }

    keywords.forEach((keyword, index) => {
      if (!keyword || keyword.trim().length === 0) {
        errors.push({
          field: `keywords[${index}]`,
          message: 'Keyword cannot be empty'
        });
      }

      if (keyword && keyword.length > 100) {
        errors.push({
          field: `keywords[${index}]`,
          message: 'Keyword must be less than 100 characters'
        });
      }

      // Check for special characters that might cause issues
      const invalidChars = /[<>]/;
      if (keyword && invalidChars.test(keyword)) {
        errors.push({
          field: `keywords[${index}]`,
          message: 'Keyword contains invalid characters'
        });
      }
    });

    // Check for duplicates
    const uniqueKeywords = new Set(keywords.map(k => k.toLowerCase().trim()));
    if (uniqueKeywords.size !== keywords.length) {
      errors.push({
        field: 'keywords',
        message: 'Duplicate keywords found'
      });
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  static validateTargetDomain(domain: string): ValidationResult {
    const errors: ValidationError[] = [];

    if (!domain || domain.trim().length === 0) {
      errors.push({
        field: 'targetDomain',
        message: 'Target domain is required'
      });
    } else {
      // Basic domain validation
      const domainRegex = /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)*[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/;
      if (!domainRegex.test(domain)) {
        errors.push({
          field: 'targetDomain',
          message: 'Please enter a valid domain name'
        });
      }
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  static validateCompetitors(competitors: string[]): ValidationResult {
    const errors: ValidationError[] = [];

    if (competitors.length > 10) {
      errors.push({
        field: 'competitors',
        message: 'Maximum 10 competitors allowed'
      });
    }

    competitors.forEach((competitor, index) => {
      if (competitor && competitor.trim().length > 0) {
        const domainRegex = /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)*[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/;
        if (!domainRegex.test(competitor.trim())) {
          errors.push({
            field: `competitors[${index}]`,
            message: 'Please enter a valid domain name'
          });
        }
      }
    });

    // Check for duplicates
    const validCompetitors = competitors.filter(c => c.trim().length > 0);
    const uniqueCompetitors = new Set(validCompetitors.map(c => c.toLowerCase().trim()));
    if (uniqueCompetitors.size !== validCompetitors.length) {
      errors.push({
        field: 'competitors',
        message: 'Duplicate competitors found'
      });
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  static validateFormData(formData: {
    keywords: string[];
    targetDomain?: string;
    location: string;
    device: string;
    searchEngine: string;
    language: string;
    competitors?: string[];
  }): ValidationResult {
    const errors: ValidationError[] = [];

    // Validate keywords
    const keywordValidation = this.validateKeywords(formData.keywords);
    errors.push(...keywordValidation.errors);

    // Validate target domain if provided
    if (formData.targetDomain) {
      const domainValidation = this.validateTargetDomain(formData.targetDomain);
      errors.push(...domainValidation.errors);
    }

    // Validate required fields
    if (!formData.location) {
      errors.push({
        field: 'location',
        message: 'Location is required'
      });
    }

    if (!formData.device) {
      errors.push({
        field: 'device',
        message: 'Device type is required'
      });
    }

    if (!formData.searchEngine) {
      errors.push({
        field: 'searchEngine',
        message: 'Search engine is required'
      });
    }

    if (!formData.language) {
      errors.push({
        field: 'language',
        message: 'Language is required'
      });
    }

    // Validate competitors if provided
    if (formData.competitors && formData.competitors.length > 0) {
      const competitorValidation = this.validateCompetitors(formData.competitors);
      errors.push(...competitorValidation.errors);
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }
}

export const formatValidationErrors = (errors: ValidationError[]): string => {
  return errors.map(error => error.message).join(', ');
};

export const getFieldError = (errors: ValidationError[], fieldName: string): string | undefined => {
  const error = errors.find(err => err.field === fieldName || err.field.startsWith(`${fieldName}[`));
  return error?.message;
};