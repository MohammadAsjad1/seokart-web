"use client";

import React, { useState, useEffect, useCallback } from "react";
import { X, Plus, Search, Loader2, AlertCircle ,Minus} from "lucide-react";

interface KeywordSuggestionModalProps {
  onAddKeywords?: (keywords: string[]) => void;
  isOpen?: boolean;
  onClose?: () => void;
}

function KeywordSuggestionModal({ 
  onAddKeywords, 
  isOpen: externalIsOpen, 
  onClose: externalOnClose 
}: KeywordSuggestionModalProps) {
  const [internalIsOpen, setInternalIsOpen] = useState<boolean>(false);
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [selectedKeywords, setSelectedKeywords] = useState<string[]>([]);
  const [keywordSuggestions, setKeywordSuggestions] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [lastQuery, setLastQuery] = useState<string>("");

  const isOpen = externalIsOpen !== undefined ? externalIsOpen : internalIsOpen;
  const setIsOpen = externalOnClose ? 
    (open: boolean) => !open && externalOnClose() : 
    setInternalIsOpen;

  const debounce = (func: (...args: any[]) => void, wait: number) => {
    let timeout: NodeJS.Timeout;
    return function executedFunction(...args: any[]) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  };

  const fetchGoogleSuggestions = async (query: string) => {
    if (!query.trim() || query === lastQuery) return;
    
    setIsLoading(true);
    setError(null);
    
    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/rank-tracker/google-suggestions?query=${encodeURIComponent(query)}`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include', 
        }
      );

      if (!response.ok) {
        const contentType = response.headers.get('content-type');
        let errorMessage = `HTTP error! status: ${response.status}`;
        
        if (contentType && contentType.includes('application/json')) {
          try {
            const errorData = await response.json();
            errorMessage = errorData.message || errorMessage;
          } catch (e) {
          }
        } else {
          const htmlText = await response.text();
          if (htmlText.includes('<!DOCTYPE')) {
            errorMessage = `Server returned HTML instead of JSON. Check API endpoint and authentication.`;
          }
        }
        
        throw new Error(errorMessage);
      }

      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        const responseText = await response.text();
        console.error('Non-JSON response received:', responseText);
        throw new Error('Server returned non-JSON response. Check API endpoint.');
      }

      const data = await response.json();
      
      if (data.success && data.data.suggestions) {
        setKeywordSuggestions(data.data.suggestions);
        setLastQuery(query);
      } else {
        throw new Error('Invalid response format');
      }
      
    } catch (err: any) {
      console.error('Error fetching suggestions:', err);
      setError(err.message || 'Failed to fetch suggestions');
    } finally {
      setIsLoading(false);
    }
  };

  const debouncedFetch = useCallback(
    debounce((query: string) => fetchGoogleSuggestions(query), 500),
    [lastQuery]
  );

  useEffect(() => {
    if (searchTerm.trim().length > 0) {
      debouncedFetch(searchTerm);
    } else {
      setKeywordSuggestions([]);
    }
  }, [searchTerm, debouncedFetch]);

  useEffect(() => {
    if (isOpen && searchTerm && keywordSuggestions.length === 0 && searchTerm.trim()) {
      fetchGoogleSuggestions(searchTerm);
    }
  }, [isOpen]);

  const filteredSuggestions: string[] = keywordSuggestions.filter((keyword: string) =>
    keyword.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleAddKeyword = (keyword: string): void => {
    if (!selectedKeywords.includes(keyword)) {
      setSelectedKeywords([...selectedKeywords, keyword]);
    }
  };

  const handleRemoveKeyword = (keyword: string): void => {
    setSelectedKeywords(selectedKeywords.filter((k: string) => k !== keyword));
  };

  const handleAddSelected = () => {
    if (onAddKeywords) {
      onAddKeywords(selectedKeywords);
    } else {
      console.log('Selected keywords:', selectedKeywords);
    }
    setSelectedKeywords([]);
    setIsOpen(false);
  };

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setSearchTerm(value);
    setError(null); 
  };

  const RetryButton = () => (
    <button
      onClick={() => fetchGoogleSuggestions(searchTerm)}
      className="text-blue-600 hover:text-blue-700 text-sm underline"
      disabled={isLoading}
    >
      {isLoading ? 'Retrying...' : 'Retry'}
    </button>
  );

  return (
    <>
      {/* Trigger Button - only show if not controlled externally */}
      {externalIsOpen === undefined && (
        <button
          onClick={() => setIsOpen(true)}
          className="custom-btn w-full text-center rounded-lg py-2 px-4 border border-transparent text-[13px] font-semibold text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          View More Keywords
        </button>
      )}

      {/* Modal Overlay */}
      {isOpen && (
        <div className="fixed inset-0 bg-[#000000ba] flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-[40vw] mx-auto h-[70vh] overflow-hidden flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-gray-200 flex-shrink-0">
              <h2 className="text-lg font-semibold text-gray-900">
                Keywords Suggestions
              </h2>
              <button
                onClick={() => setIsOpen(false)}
                className="p-1 hover:bg-gray-100 rounded-full transition-colors"
              >
                <X size={20} className="text-gray-500" />
              </button>
            </div>

            {/* Search Input */}
            <div className="p-4 border-b border-gray-100 flex-shrink-0">
              <div className="relative">
                <Search size={16} className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={handleSearchChange}
                  placeholder="Search keywords..."
                  className="w-full pl-10 pr-10 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-black-500 focus:border-transparent"
                />
                {isLoading && (
                  <Loader2 size={16} className="absolute right-3 top-1/2 transform -translate-y-1/2 text-black-500 animate-spin" />
                )}
              </div>
              
              {/* Error Message */}
              {error && (
                <div className="mt-2 flex items-center gap-2 text-sm text-amber-600 bg-amber-50 p-2 rounded-lg">
                  <AlertCircle size={14} />
                  <span className="flex-1">{error}</span>
                  <RetryButton />
                </div>
              )}
            </div>

            {/* Selected Keywords */}
            {selectedKeywords.length > 0 && (
              <div className="p-4 border-b border-gray-100 flex-shrink-0">
                <h3 className="text-sm font-medium text-gray-700 mb-2">Selected Keywords:</h3>
                <div className="flex flex-wrap gap-2">
                  {selectedKeywords.map((keyword: string) => (
                    <span
                      key={keyword}
                      className="inline-flex items-center gap-1 px-3 py-1 bg-[#f0f1f4] text-black rounded-full text-sm border border-[#e5e7eb] hover:bg-[#d0d2d6] transition-colors"
                    >
                      {keyword}
                      <button
                        onClick={() => handleRemoveKeyword(keyword)}
                        className="hover:bg-blue-200 rounded-full p-0.5"
                      >
                        <X size={12} />
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Suggestions List */}
            <div className="p-4 flex-1 overflow-hidden flex flex-col">
              {!searchTerm.trim() ? (
                <div className="flex items-center justify-center h-full">
                  <div className="text-center text-gray-500">
                    <Search size={32} className="mx-auto mb-2 text-gray-300" />
                    <p className="text-sm">Search for keyword suggestions</p>
                  </div>
                </div>
              ) : (
                <>
                  <h3 className="text-sm font-medium text-gray-700 mb-3 flex-shrink-0">
                    Suggestions:
                    {keywordSuggestions.length > 0 && (
                      <span className="text-gray-500 font-normal ml-1">
                        ({filteredSuggestions.length} found)
                      </span>
                    )}
                  </h3>
                  
                  <div className="flex-1 overflow-y-auto">
                    {isLoading && keywordSuggestions.length === 0 ? (
                      <div className="text-center text-gray-500 py-8">
                        <Loader2 size={32} className="mx-auto mb-2 text-gray-300 animate-spin" />
                        <p className="text-sm">Loading suggestions...</p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {filteredSuggestions.map((keyword, index) => (
                          <div
                            key={index}
                            className="flex items-center justify-between p-2 hover:bg-gray-50 rounded-lg transition-colors group"
                          >
                            <span className="text-gray-700 text-sm">{keyword}</span>
                            <button
                              onClick={() => handleAddKeyword(keyword)}
                              disabled={selectedKeywords.includes(keyword)}
                              className={`p-1.5 rounded-full transition-all ${
                                selectedKeywords.includes(keyword)
                                  ? 'bg-green-100 text-green-600 cursor-not-allowed'
                                  : 'bg-gray-100 text-gray-600 hover:bg-blue-100 hover:text-blue-600 group-hover:scale-110'
                              }`}
                            >
                              {selectedKeywords.includes(keyword) ? (
                                <Minus className="w-4 h-4" />
                              ) : (
                                <Plus size={14} />
                              )}
                            </button>
                          </div>
                        ))}
                      </div>
                    )}

                    {!isLoading && filteredSuggestions.length === 0 && searchTerm.trim() && (
                      <div className="text-center text-gray-500 py-8">
                        <Search size={32} className="mx-auto mb-2 text-gray-300" />
                        <p className="text-sm">No keywords found matching &quot;{searchTerm}&quot;</p>
                        {error && (
                          <div className="mt-2">
                            <RetryButton />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>

            {/* Footer - Fixed at bottom */}
            <div className="p-4 border-t border-gray-100 flex justify-end gap-3 flex-shrink-0">
              <button
                onClick={() => setIsOpen(false)}
                className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleAddSelected}
                disabled={selectedKeywords.length === 0}
                className={`px-4 py-2 rounded-lg transition-colors ${
                  selectedKeywords.length === 0
                    ?   "custom-btn rounded-lg py-2 px-4 border border-transparent text-center text-[13px] font-semibold text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                    : "custom-btn rounded-lg py-2 px-4 border border-transparent text-center text-[13px] font-semibold text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"

                }`}
              >
                Add Selected ({selectedKeywords.length})
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default KeywordSuggestionModal;