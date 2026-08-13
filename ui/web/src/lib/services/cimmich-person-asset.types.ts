export type CimmichPersonAssetContext<TContextTypeKind extends string> = {
  displayName: string;
  entityId: string;
  entityKind: 'event' | 'object' | 'place';
  typeKind: TContextTypeKind;
};

export type CimmichPersonAssetFaceCrop = {
  box_h: number;
  box_w: number;
  box_x: number;
  box_y: number;
  face_id: string;
};

export type CimmichPersonAssetProjection<TContextTypeKind extends string, TVisibilityTier extends string> = {
  asset_id: string;
  asset_head_evidence: boolean;
  association_types: Array<'body' | 'body_candidate' | 'face' | 'head' | 'presence'>;
  capture_time: string | null;
  contexts: CimmichPersonAssetContext<TContextTypeKind>[];
  face_crop?: CimmichPersonAssetFaceCrop | null;
  labels?: Array<{ displayName: string; labelId: string }>;
  filename: string;
  height: number;
  has_linked_body: boolean;
  media_kind: 'image' | 'video';
  mime_type: string;
  presence_evidence: boolean;
  privacy_tier?: TVisibilityTier;
  sourceAssetId: string;
  width: number;
};
