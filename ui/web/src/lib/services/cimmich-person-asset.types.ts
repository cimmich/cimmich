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
