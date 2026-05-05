import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/utils";

const buttonVariants = cva("vault-ai-shadcn-button", {
  variants: {
    variant: {
      default: "vault-ai-shadcn-button-default",
      ghost: "vault-ai-shadcn-button-ghost"
    },
    size: {
      default: "vault-ai-shadcn-button-size-default",
      icon: "vault-ai-shadcn-button-size-icon"
    }
  },
  defaultVariants: {
    variant: "default",
    size: "default"
  }
});

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp className={cn(buttonVariants({ variant, size }), className)} ref={ref} {...props} />;
  }
);

Button.displayName = "Button";
