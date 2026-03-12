import React, { useState } from "react";
import {
  DrawerClose,
  DrawerContent,
  DrawerTitle,
  DrawerFooter,
  DrawerHeader,
} from "@/components/ui/drawer";
import { Button } from "@/components/ui/Button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ChevronDown, ExternalLink } from "lucide-react";
import { getStatusIcon} from "../../components/scraperUtils";

interface Webpage {
  _id: string;
  pageUrl: string;
  content: {
    title: string;
    titleLength: number;
    metaDescription: string;
    metaDescriptionLength: number;
    wordCount: number;
    headingStructure: {
      h1Count: number;
      h2Count: number;
    };
  };
  technical: {
    links: {
      totalCount: number;
      internalCount: number;
      externalCount: number;
      internalBrokenLinksCount: number;
      externalBrokenLinksCount: number;
      redirectLinksCount: number;
    };
    internalBrokenLinks: Array<{
      url: string;
      text: string;
      statusCode: number;
      error: string;
    }>;
    externalBrokenLinks: Array<{
      url: string;
      text: string;
      statusCode: number;
      error: string;
    }>;
    redirectLinks: Array<{
      url: string;
      text: string;
      statusCode: number;
      redirectTo: string;
      type: string;
    }>;
  };
  analysis: {
    images: {
      totalCount: number;
      withAlt: number;
      altMissingCount: number;
    };
    contentQuality: {
      spellingErrors: string[];
      grammarErrors: string[];
    };
  };
  scores: {
    scores: {
      titleNotMissing: number;
      titleRightLength: number;
      metaDescNotMissing: number;
      metaDescRightLength: number;
      noMultipleTitles: number;
      titleNotDuplicated: number;
      metaDescNotDuplicated: number;
      contentNotTooShort: number;
      noGrammarSpellingErrors: number;
      oneH1Only: number;
      headingsProperOrder: number;
      contentNotDuplicated: number;
      imagesHaveAltText: number;
      urlNotTooLong: number;
      noInternalBrokenLinks: number;
      noExternalBrokenLinks: number;
      internalLinksGood: number;
      externalLinksBalanced: number;
      canonicalTagExists: number;
      mobileResponsive: number;
    };
  };
}

type Props = {
  webpage?: Webpage;
};

interface AccordionItemProps {
  label: string;
  isSuccess: boolean;
  hasError: boolean;
  errorContent?: React.ReactNode;
}

const AccordionItem = ({ label, isSuccess, hasError, errorContent }: AccordionItemProps) => {
  const [isOpen, setIsOpen] = useState(false);

  const toggleAccordion = () => {
    if (hasError) {
      setIsOpen(!isOpen);
    }
  };

  return (
    <li className="mt-5">
      <div className="flex justify-between items-center">
        <div 
          className={`flex items-center gap-2 flex-1 ${hasError ? 'cursor-pointer' : ''}`}
          onClick={toggleAccordion}
        >
          {hasError && (
            <div
              className="transition-transform duration-200"
              style={{ transform: isOpen ? "rotate(180deg)" : "rotate(0deg)" }}
            >
              <ChevronDown size={16} className="text-gray-600" />
            </div>
          )}
          {!hasError && <div className="w-4" />}
          <span className={`flex-1 text-sm ${hasError ? 'text-red-700' : ''}`}>{label}</span>
        </div>
        {getStatusIcon(isSuccess)}
      </div>
      {hasError && (
        <div
          className="overflow-hidden transition-all duration-300 ease-in-out"
          style={{
            maxHeight: isOpen ? "500px" : "0",
            opacity: isOpen ? 1 : 0,
          }}
        >
          <div className="mt-3 ml-6 p-4 bg-red-50 rounded-lg border border-red-200 max-w-[550px]">
            {errorContent}
          </div>
        </div>
      )}
    </li>
  );
};

export default function OptimizeSidebar({ webpage }: Props) {
  if (!webpage) return null;

  const parseSpellingError = (error: string) => {
    const match = error.match(/^(.+?)\s*\(suggestion:\s*(.+?)\)$/);
    if (match) {
      return { word: match[1], suggestion: match[2] };
    }
    return { word: error, suggestion: "No suggestion" };
  };

  return (
    <DrawerContent className="optimize-drawer bg-[#fff] w-[650px] right-2 left-initial m-0 fixed top-2 rounded-2xl">
      <div className="w-full">
        <div className="drawer-head flex justify-between items-center gap-3 bg-[#F3F3F3] py-4 px-5 rounded-t-2xl">
        <DrawerHeader className="p-0">
          <div className="flex items-center gap-2">
            <DrawerTitle className="text-sm font-medium text-ellipsis whitespace-nowrap max-w-[300px] overflow-hidden">
              {webpage.pageUrl}
            </DrawerTitle>
            <a href={webpage.pageUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink size={16} />
            </a>
          </div>
        </DrawerHeader>

          <DrawerFooter className="p-0">
            <DrawerClose asChild>
              <Button
                variant="outline"
                className="p-0 bg-transparent border-transparent shadow-none cursor-pointer"
              >
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 20 20"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M13.9697 15.0303C14.2626 15.3232 14.7374 15.3232 15.0303 15.0303C15.3232 14.7374 15.3232 14.2626 15.0303 13.9697L11.0607 10L15.0303 6.03033C15.3232 5.73744 15.3232 5.26256 15.0303 4.96967C14.7374 4.67678 14.2626 4.67678 13.9697 4.96967L10 8.93934L6.03033 4.96967C5.73744 4.67678 5.26256 4.67678 4.96967 4.96967C4.67678 5.26256 4.67678 5.73744 4.96967 6.03033L8.93934 10L4.96967 13.9697C4.67678 14.2626 4.67678 14.7374 4.96967 15.0303C5.26256 15.3232 5.73744 15.3232 6.03033 15.0303L10 11.0607L13.9697 15.0303Z"
                    fill="#4A4A4A"
                  />
                </svg>
              </Button>
            </DrawerClose>
          </DrawerFooter>
        </div>

        <ScrollArea className="technical-drawerErrors h-[calc(100vh-100px)]">
          {/* Meta Tag Issues */}
          <div className="drawer-errorBox p-5 border-b border-[#DEE2E6]">
            <h3 className="text-lg font-semibold">Meta Tag Issues</h3>
            <ul>
              <AccordionItem
                label="Title Tag is Present"
                isSuccess={webpage.scores?.scores?.titleNotMissing === 5}
                hasError={webpage.scores?.scores?.titleNotMissing !== 5}
                errorContent={
                  <div>
                    <p className="text-sm text-red-700 font-medium">
                      Title tag is missing from the page.
                    </p>
                    <p className="text-sm text-gray-600 mt-1">
                      Add a title tag to improve SEO and user experience.
                    </p>
                  </div>
                }
              />
              <AccordionItem
                label="Title Tag Length is Optimal (40–60 characters)"
                isSuccess={webpage.scores?.scores?.titleRightLength === 5}
                hasError={webpage.scores?.scores?.titleRightLength !== 5}
                errorContent={
                  <div>
                    <p className="text-sm text-red-700 font-medium">
                      Current title length: {webpage.content?.titleLength || 0} characters
                    </p>
                    <p className="text-sm text-gray-600 mt-1">
                      Optimal title length is between 40-60 characters.
                    </p>
                  </div>
                }
              />
              <AccordionItem
                label="Meta Description is Present"
                isSuccess={webpage.scores?.scores?.metaDescNotMissing === 5}
                hasError={webpage.scores?.scores?.metaDescNotMissing !== 5}
                errorContent={
                  <div>
                    <p className="text-sm text-red-700 font-medium">
                      Meta description is missing from the page.
                    </p>
                  </div>
                }
              />
              <AccordionItem
                label="Meta Description Length is Optimal (120–160 characters)"
                isSuccess={webpage.scores?.scores?.metaDescRightLength === 5}
                hasError={webpage.scores?.scores?.metaDescRightLength !== 5}
                errorContent={
                  <div>
                    <p className="text-sm text-red-700 font-medium">
                      Current description length: {webpage.content?.metaDescriptionLength || 0} characters
                    </p>
                    <p className="text-sm text-gray-600 mt-1">
                      Optimal meta description length is between 120-160 characters.
                    </p>
                  </div>
                }
              />
              <AccordionItem
                label="Only One Title Tag Present"
                isSuccess={webpage.scores?.scores?.noMultipleTitles === 5}
                hasError={webpage.scores?.scores?.noMultipleTitles !== 5}
                errorContent={
                  <div>
                    <p className="text-sm text-red-700 font-medium">
                      Multiple title tags detected on the page.
                    </p>
                  </div>
                }
              />
              <AccordionItem
                label="Unique Title Tag"
                isSuccess={webpage.scores?.scores?.titleNotDuplicated === 5}
                hasError={webpage.scores?.scores?.titleNotDuplicated !== 5}
                errorContent={
                  <div>
                    <p className="text-sm text-red-700 font-medium">
                      Title tag is duplicated across multiple pages.
                    </p>
                  </div>
                }
              />
              <AccordionItem
                label="Unique Meta Description"
                isSuccess={webpage.scores?.scores?.metaDescNotDuplicated === 5}
                hasError={webpage.scores?.scores?.metaDescNotDuplicated !== 5}
                errorContent={
                  <div>
                    <p className="text-sm text-red-700 font-medium">
                      Meta description is duplicated across multiple pages.
                    </p>
                  </div>
                }
              />
            </ul>
          </div>

          {/* Content Issues */}
          <div className="drawer-errorBox p-5 border-b border-[#DEE2E6]">
            <h3 className="text-lg font-semibold">Content Issues</h3>
            <ul>
              <AccordionItem
                label="Content Length is Sufficient (More Than 200 Words)"
                isSuccess={webpage.scores?.scores?.contentNotTooShort === 5}
                hasError={webpage.scores?.scores?.contentNotTooShort !== 5}
                errorContent={
                  <div>
                    <p className="text-sm text-red-700 font-medium">
                      Current word count: {webpage.content?.wordCount || 0} words
                    </p>
                    <p className="text-sm text-gray-600 mt-1">
                      Content should have at least 200 words for better SEO.
                    </p>
                  </div>
                }
              />
              <AccordionItem
                label="No Spelling Errors"
                isSuccess={webpage.scores?.scores?.noGrammarSpellingErrors === 5}
                hasError={webpage.scores?.scores?.noGrammarSpellingErrors !== 5}
                errorContent={
                  <div>
                    {webpage.analysis?.contentQuality?.spellingErrors?.length > 0 && (
                      <div className="mb-3">
                        <p className="text-sm text-red-700 font-medium mb-2">
                          Spelling Errors Found: {webpage.analysis.contentQuality.spellingErrors.length}
                        </p>
                        <div className="space-y-2 max-h-60 overflow-y-auto">
                          {webpage.analysis.contentQuality.spellingErrors.map((error, index) => {
                            const { word, suggestion } = parseSpellingError(error);
                            return (
                              <div key={index} className="flex justify-between items-center bg-white p-2 rounded border border-red-200">
                                <span className="text-sm text-red-700 font-medium">{word}</span>
                                <span className="text-sm text-gray-600">→ {suggestion}</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                    {webpage.analysis?.contentQuality?.grammarErrors?.length > 0 && (
                      <div>
                        <p className="text-sm text-red-700 font-medium mb-2">
                          Grammar Errors Found: {webpage.analysis.contentQuality.grammarErrors.length}
                        </p>
                        <div className="space-y-1">
                          {webpage.analysis.contentQuality.grammarErrors.map((error, index) => (
                            <p key={index} className="text-sm text-gray-700">• {error}</p>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                }
              />
              <AccordionItem
                label="H1 Tag Present on the Top"
                isSuccess={webpage.scores?.scores?.oneH1Only === 5}
                hasError={webpage.scores?.scores?.oneH1Only !== 5}
                errorContent={
                  <div>
                    <p className="text-sm text-red-700 font-medium">
                      H1 count: {webpage.content?.headingStructure?.h1Count || 0}
                    </p>
                    <p className="text-sm text-gray-600 mt-1">
                      Page should have exactly one H1 tag.
                    </p>
                  </div>
                }
              />
              <AccordionItem
                label="Headings in Proper Order"
                isSuccess={webpage.scores?.scores?.headingsProperOrder === 5}
                hasError={webpage.scores?.scores?.headingsProperOrder !== 5}
                errorContent={
                  <div>
                    <p className="text-sm text-red-700 font-medium">
                      Headings are not in proper hierarchical order.
                    </p>
                  </div>
                }
              />
              <AccordionItem
                label="No Duplicate Content Found"
                isSuccess={webpage.scores?.scores?.contentNotDuplicated === 5}
                hasError={webpage.scores?.scores?.contentNotDuplicated !== 5}
                errorContent={
                  <div>
                    <p className="text-sm text-red-700 font-medium">
                      Duplicate content detected on the page.
                    </p>
                  </div>
                }
              />
            </ul>
          </div>

          {/* Images Issues */}
          <div className="drawer-errorBox p-5 border-b border-[#DEE2E6]">
            <h3 className="text-lg font-semibold">Images Issues</h3>
            <ul>
              <AccordionItem
                label="Images Have Alt Text"
                isSuccess={webpage.scores?.scores?.imagesHaveAltText === 5}
                hasError={webpage.scores?.scores?.imagesHaveAltText !== 5}
                errorContent={
                  <div>
                    <p className="text-sm text-red-700 font-medium">
                      {webpage.analysis?.images?.altMissingCount || 0} out of {webpage.analysis?.images?.totalCount || 0} images are missing alt text.
                    </p>
                    <p className="text-sm text-gray-600 mt-1">
                      All images should have descriptive alt text for accessibility and SEO.
                    </p>
                  </div>
                }
              />
            </ul>
          </div>

          {/* URL Issues */}
          <div className="drawer-errorBox p-5 border-b border-[#DEE2E6]">
            <h3 className="text-lg font-semibold">URL Issues</h3>
            <ul>
              <AccordionItem
                label="URL Length is Optimal"
                isSuccess={webpage.scores?.scores?.urlNotTooLong === 5}
                hasError={webpage.scores?.scores?.urlNotTooLong !== 5}
                errorContent={
                  <div>
                    <p className="text-sm text-red-700 font-medium">
                      URL is too long for optimal SEO.
                    </p>
                  </div>
                }
              />
              <AccordionItem
                label="No Internal Broken Links"
                isSuccess={webpage.scores?.scores?.noInternalBrokenLinks === 5}
                hasError={webpage.scores?.scores?.noInternalBrokenLinks !== 5}
                errorContent={
                  <div>
                    <p className="text-sm text-red-700 font-medium mb-2">
                      Internal Broken Links Found: {webpage.technical?.internalBrokenLinks?.length || 0}
                    </p>
                    {webpage.technical?.internalBrokenLinks?.length > 0 && (
                      <div className="space-y-2 max-h-60 overflow-y-auto">
                        {webpage.technical.internalBrokenLinks.map((link, index) => (
                          <div key={index} className="bg-white p-3 rounded border border-red-200">
                            <a
                              href={link.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-sm text-blue-600 hover:text-blue-800 underline break-all"
                            >
                              {link.url}
                            </a>
                            <div className="flex justify-between items-center mt-1">
                              <span className="text-xs text-gray-600 max-w-[300px] overflow-x-hidden overflow-y-auto text-ellipsis">{link.text}</span>
                              <span className="text-xs text-red-600 font-medium">Status: {link.statusCode}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                }
              />
              <AccordionItem
                label="No External Broken Links"
                isSuccess={webpage.scores?.scores?.noExternalBrokenLinks === 5}
                hasError={webpage.scores?.scores?.noExternalBrokenLinks !== 5}
                errorContent={
                  <div>
                    <p className="text-sm text-red-700 font-medium mb-2">
                      External Broken Links Found: {webpage.technical?.externalBrokenLinks?.length || 0}
                    </p>
                    {webpage.technical?.externalBrokenLinks?.length > 0 && (
                      <div className="space-y-2 max-h-60 overflow-y-auto">
                        {webpage.technical.externalBrokenLinks.map((link, index) => (
                          <div key={index} className="bg-white p-3 rounded border border-red-200">
                            <a
                              href={link.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-sm text-blue-600 hover:text-blue-800 underline break-all"
                            >
                              {link.url}
                            </a>
                            <div className="flex justify-between items-center mt-1">
                              <span className="text-xs text-gray-600 max-w-[300px] overflow-y-auto overflow-x-hidden text-ellipsis ">{link.text}</span>
                              <span className="text-xs text-red-600 font-medium">Status: {link.statusCode}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                }
              />
              <AccordionItem
                label="Redirect Links"
                isSuccess={(webpage.technical?.links?.redirectLinksCount || 0) === 0}
                hasError={(webpage.technical?.links?.redirectLinksCount || 0) > 0}
                errorContent={
                  <div>
                    <p className="text-sm text-red-700 font-medium mb-2">
                      Redirect Links Found: {webpage.technical?.redirectLinks?.length || 0}
                    </p>
                    {webpage.technical?.redirectLinks?.length > 0 && (
                      <div className="space-y-2 max-h-60 overflow-y-auto">
                        {webpage.technical.redirectLinks.map((link, index) => (
                          <div key={index} className="bg-white p-3 rounded border border-orange-200">
                            <a
                              href={link.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-sm text-blue-600 hover:text-blue-800 underline break-all"
                            >
                              {link.url}
                            </a>
                            <div className="mt-1">
                              <span className="text-xs text-gray-600 max-w-[300px] overflow-y-auto text-ellipsis overflow-x-hidden">{link.text}</span>
                              <div className="flex justify-between items-center mt-1">
                                <span className="text-xs text-orange-600 max-w-[300px] overflow-y-auto text-ellipsis overflow-x-hidden">→ {link.redirectTo}</span>
                                <span className="text-xs text-orange-600 font-medium">Status: {link.statusCode}</span>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                }
              />
             
            </ul>
          </div>

          {/* Technical SEO Issues */}
          <div className="drawer-errorBox p-5 border-b border-[#DEE2E6]">
            <h3 className="text-lg font-semibold">Technical SEO Issues</h3>
            <ul>
              <AccordionItem
                label="Canonical Tag Exists"
                isSuccess={webpage.scores?.scores?.canonicalTagExists === 5}
                hasError={webpage.scores?.scores?.canonicalTagExists !== 5}
                errorContent={
                  <div>
                    <p className="text-sm text-red-700 font-medium">
                      Canonical tag is missing from the page.
                    </p>
                  </div>
                }
              />
              <AccordionItem
                label="Webpage is Mobile Responsive"
                isSuccess={webpage.scores?.scores?.mobileResponsive === 5}
                hasError={webpage.scores?.scores?.mobileResponsive !== 5}
                errorContent={
                  <div>
                    <p className="text-sm text-red-700 font-medium">
                      Page is not mobile responsive.
                    </p>
                    <p className="text-sm text-gray-600 mt-1">
                      Ensure your page is optimized for mobile devices.
                    </p>
                  </div>
                }
              />
            </ul>
          </div>
        </ScrollArea>
      </div>
    </DrawerContent>
  );
}