"use client";

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type RequiredDropdownValueProps =
  | { value: string; onValueChange: (value: string) => void; defaultValue?: never; onChange?: never }
  | { defaultValue: string; onChange: (value: string) => void; value?: never; onValueChange?: never }

type DropdownCustomProps = RequiredDropdownValueProps & {
  options: { value: string; label: string }[];
  placeholder: string;
  disabled?: boolean;
  className?: string;
};

function DropdownCustom({ 
  options, 
  placeholder, 
  defaultValue, 
  value, // Add value prop
  onChange,
  onValueChange, 
  disabled = false,
  className = ""
}: DropdownCustomProps) {
  const handleChange = onValueChange || onChange;

  return (
    <Select 
      value={value || defaultValue} // Use value prop if provided, otherwise defaultValue
      onValueChange={handleChange}
      disabled={disabled}
    >
      <SelectTrigger className={`border border-[#dee2e6] h-[38px] shadow-none text-[13px] focus:border-slate-400 focus:ring-0 ${disabled ? 'opacity-50 cursor-not-allowed' : ''} ${className}`}>
        <SelectValue placeholder={placeholder || "Select"} />
      </SelectTrigger>
      
      <SelectContent>
        <SelectGroup>
          {options.map((option, index) => (
            <SelectItem key={index} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

export default DropdownCustom;