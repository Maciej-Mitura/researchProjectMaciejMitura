import { Card, CardContent } from "@/components/ui/card";

export function PrivacyStatement() {
  return (
    <Card className="border-primary/20 bg-primary/5">
      <CardContent className="pt-6">
        <div className="space-y-2">
          <p className="text-sm font-semibold text-foreground">
            Privacy & Data Protection
          </p>
          <p className="text-sm leading-relaxed text-muted-foreground">
            <strong>No video is stored.</strong> All processing happens locally
            in your browser. Your camera feed is never transmitted to any
            server, ensuring complete privacy and GDPR compliance. All pose
            detection and analysis occurs entirely on your device.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

