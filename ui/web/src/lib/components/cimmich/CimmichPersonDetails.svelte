<script lang="ts">
  import {
    CimmichServiceError,
    createCimmichPersonProfileCommandId,
    createCimmichPersonProfileItemId,
    patchCimmichPersonDetailsDisplay,
    patchCimmichPersonDetailsDisplayDefaults,
    patchCimmichPersonProfile,
    patchCimmichPersonProfileDisplay,
    patchCimmichPersonProfileDisplayDefaults,
    type CimmichPersonDetailsDisplay,
    type CimmichPersonDetailsDisplayDefaults,
    type CimmichPersonDetailsSectionKey,
    type CimmichPersonProfileDisplay,
    type CimmichPersonProfileDisplayDefaults,
    type CimmichPersonProfileFieldKey,
    type CimmichPersonProfileItem,
    type CimmichPersonProfileItemCommand,
    type CimmichPersonProfileItemKind,
    type CimmichPersonProfilePatch,
    type CimmichPersonProfileProjection,
  } from '$lib/services/cimmich.service';
  import {
    mdiAccountDetailsOutline,
    mdiAt,
    mdiBriefcaseOutline,
    mdiCalendarOutline,
    mdiContentSaveOutline,
    mdiEmailOutline,
    mdiEyeSettingsOutline,
    mdiGenderFemale,
    mdiGenderMale,
    mdiGenderMaleFemaleVariant,
    mdiGenderNonBinary,
    mdiHelpCircleOutline,
    mdiMapMarkerOutline,
    mdiNoteTextOutline,
    mdiPencilOutline,
    mdiPhoneOutline,
    mdiPlus,
    mdiTrashCanOutline,
    mdiWeb,
  } from '@mdi/js';
  import { Icon } from '@immich/ui';
  import { tick } from 'svelte';

  type EditorView = 'defaults' | 'display' | 'profile';
  type GenderKind = CimmichPersonProfileProjection['profile']['genderIdentityKind'];
  type ItemField = 'date' | 'label' | 'value';
  type ProfileEditTarget = 'about' | 'at_a_glance' | 'contact' | 'private_notes' | CimmichPersonProfileItemKind;
  type Visibility = CimmichPersonProfileDisplay['fields'][number]['visibility'];
  type DetailsVisibility = CimmichPersonDetailsDisplay['sections'][number]['visibility'];

  interface Props {
    aliases: string[];
    compact?: boolean;
    defaults: CimmichPersonProfileDisplayDefaults;
    detailsDefaults: CimmichPersonDetailsDisplayDefaults;
    detailsDisplay: CimmichPersonDetailsDisplay;
    display: CimmichPersonProfileDisplay;
    ondefaultschange: (value: CimmichPersonProfileDisplayDefaults) => void;
    ondetailsdefaultschange: (value: CimmichPersonDetailsDisplayDefaults) => void;
    ondetailsdisplaychange: (value: CimmichPersonDetailsDisplay) => void;
    ondisplaychange: (value: CimmichPersonProfileDisplay) => void;
    onopenidentitysettings: () => void;
    onprofilechange: (value: CimmichPersonProfileProjection) => void;
    profile: CimmichPersonProfileProjection;
    railManaged?: boolean;
    startInEdit?: boolean;
  }

  let {
    aliases,
    compact = false,
    defaults,
    detailsDefaults,
    detailsDisplay,
    display,
    ondefaultschange,
    ondetailsdefaultschange,
    ondetailsdisplaychange,
    ondisplaychange,
    onopenidentitysettings,
    onprofilechange,
    profile,
    railManaged = false,
    startInEdit = false,
  }: Props = $props();

  let aboutEditorElement = $state<HTMLTextAreaElement>();
  let aboutDraft = $state('');
  let busy = $state('');
  let detailsDefaultDraft = $state<Record<CimmichPersonDetailsSectionKey, boolean>>({
    about: true,
    address: true,
    at_a_glance: true,
    contact_details: true,
    identity_summary: true,
    important_dates: true,
    private_notes: true,
    social: true,
    work: true,
  });
  let detailsPersonDraft = $state<Record<CimmichPersonDetailsSectionKey, DetailsVisibility>>({
    about: 'inherit',
    address: 'inherit',
    at_a_glance: 'inherit',
    contact_details: 'inherit',
    identity_summary: 'inherit',
    important_dates: 'inherit',
    private_notes: 'inherit',
    social: 'inherit',
    work: 'inherit',
  });
  let detailsSettingsOpen = $state(false);
  let detailsSettingsView = $state<'defaults' | 'person'>('person');
  let editing = $state(false);
  let editorView = $state<EditorView>('profile');
  let errorMessage = $state('');
  let genderFieldError = $state('');
  let genderKindDraft = $state<GenderKind>(null);
  let genderLabelDraft = $state('');
  let globalVisibilityDraft = $state<Record<CimmichPersonProfileFieldKey, boolean>>({
    about: true,
    aliases: true,
    gender_identity: true,
    important_dates: true,
    photo_history: true,
    pronouns: true,
    relationships: true,
    work: true,
  });
  let itemDateDraft = $state('');
  let itemEditId = $state('');
  let itemEditorElement = $state<HTMLDivElement>();
  let itemFieldError = $state<{ field: ItemField; message: string }>();
  let itemKindDraft = $state<CimmichPersonProfileItemKind>('important_date');
  let itemLabelDraft = $state('');
  let itemSecondaryDraft = $state('');
  let itemValueDraft = $state('');
  let itemsDraft = $state<CimmichPersonProfileItem[]>([]);
  let inlineError = $state('');
  let inlineTarget = $state<ProfileEditTarget>();
  let message = $state('');
  let personVisibilityDraft = $state<Record<CimmichPersonProfileFieldKey, Visibility>>({
    about: 'inherit',
    aliases: 'inherit',
    gender_identity: 'inherit',
    important_dates: 'inherit',
    photo_history: 'inherit',
    pronouns: 'inherit',
    relationships: 'inherit',
    work: 'inherit',
  });
  let privateNotesDraft = $state('');
  let privateNotesEditorElement = $state<HTMLTextAreaElement>();
  let pronounsDraft = $state('');
  let relationshipEditorElement = $state<HTMLFieldSetElement>();
  let relationshipDraft = $state<string[]>([]);
  let removeConfirmId = $state('');
  let startInEditHandled = false;

  const fieldLabels: Record<CimmichPersonProfileFieldKey, string> = {
    about: 'About',
    aliases: 'Aliases',
    gender_identity: 'Gender identity',
    important_dates: 'Important dates',
    photo_history: 'Photo history',
    pronouns: 'Pronouns',
    relationships: 'Relationships',
    work: 'Work',
  };

  const detailsSectionLabels: Record<CimmichPersonDetailsSectionKey, string> = {
    about: 'About',
    address: 'Addresses',
    at_a_glance: 'At a glance',
    contact_details: 'Contact details',
    identity_summary: 'Identity',
    important_dates: 'Important dates',
    private_notes: 'Notes',
    social: 'Social profiles',
    work: 'Work and organisations',
  };

  const dossierSectionNumbers: Partial<Record<CimmichPersonProfileItemKind, string>> = {
    important_date: '04',
    work: '05',
    social: '07',
    address: '08',
  };

  const dossierEmptyPrompts: Partial<Record<CimmichPersonProfileItemKind, string>> = {
    important_date: 'Add a birthday, anniversary, or date worth remembering.',
    work: 'Add work, study, or an organisation connected to this person.',
    social: 'Add a social profile or online presence.',
    address: 'Add a place connected to this person.',
  };

  const visibleDetailsSection = (sectionKey: CimmichPersonDetailsSectionKey) =>
    detailsDisplay.sections.find((section) => section.sectionKey === sectionKey)?.effectiveVisible ?? true;
  const orderedDetailsDisplaySections = $derived([...detailsDisplay.sections].sort((a, b) => a.order - b.order));
  const orderedDetailsDefaultSections = $derived([...detailsDefaults.sections].sort((a, b) => a.order - b.order));

  const openDetailsSettings = (view: 'defaults' | 'person' = 'person') => {
    detailsDefaultDraft = Object.fromEntries(
      detailsDefaults.sections.map(({ sectionKey, visible }) => [sectionKey, visible]),
    ) as Record<CimmichPersonDetailsSectionKey, boolean>;
    detailsPersonDraft = Object.fromEntries(
      detailsDisplay.sections.map(({ sectionKey, visibility }) => [sectionKey, visibility]),
    ) as Record<CimmichPersonDetailsSectionKey, DetailsVisibility>;
    detailsSettingsView = view;
    detailsSettingsOpen = true;
    editing = false;
    inlineTarget = undefined;
    errorMessage = '';
    message = '';
  };

  const closeDetailsSettings = () => {
    detailsSettingsOpen = false;
    errorMessage = '';
  };

  const itemKindOptions: Array<{ kind: CimmichPersonProfileItemKind; label: string }> = [
    { kind: 'important_date', label: 'Important date' },
    { kind: 'work', label: 'Work or organisation' },
    { kind: 'email', label: 'Email' },
    { kind: 'phone', label: 'Phone' },
    { kind: 'social', label: 'Social profile' },
    { kind: 'web', label: 'Website' },
    { kind: 'address', label: 'Address' },
  ];

  const quickDetailActions: Array<{ icon: string; label: string; target: ProfileEditTarget }> = [
    { icon: mdiCalendarOutline, label: 'Important date', target: 'important_date' },
    { icon: mdiBriefcaseOutline, label: 'Work', target: 'work' },
    { icon: mdiPhoneOutline, label: 'Contact', target: 'contact' },
    { icon: mdiAt, label: 'Social profile', target: 'social' },
    { icon: mdiMapMarkerOutline, label: 'Address', target: 'address' },
    { icon: mdiNoteTextOutline, label: 'Note', target: 'private_notes' },
  ];

  const contactKinds: CimmichPersonProfileItemKind[] = ['phone', 'email', 'web'];
  const sectionOrder = new Set<CimmichPersonProfileItemKind>(['important_date', 'work', 'social', 'address']);

  const sectionLabels: Record<CimmichPersonProfileItemKind, string> = {
    address: 'Addresses',
    custom: 'Other details',
    email: 'Email',
    important_date: 'Important dates',
    phone: 'Phone',
    social: 'Social profiles',
    web: 'Websites',
    work: 'Work and organisations',
  };

  const sectionIcons: Record<CimmichPersonProfileItemKind, string> = {
    address: mdiMapMarkerOutline,
    custom: mdiNoteTextOutline,
    email: mdiEmailOutline,
    important_date: mdiCalendarOutline,
    phone: mdiPhoneOutline,
    social: mdiAt,
    web: mdiWeb,
    work: mdiBriefcaseOutline,
  };

  const contactItems = $derived(profile.items.filter(({ kind }) => contactKinds.includes(kind)));
  const hasItems = (kind: CimmichPersonProfileItemKind) => profile.items.some((item) => item.kind === kind);
  const genderLabel = $derived(
    profile.profile.genderIdentityKind === 'self_described'
      ? profile.profile.genderIdentityLabel
      : profile.profile.genderIdentityKind === 'non_binary'
        ? 'Non-binary'
        : profile.profile.genderIdentityKind === 'woman'
          ? 'Woman'
          : profile.profile.genderIdentityKind === 'man'
            ? 'Man'
            : null,
  );
  const genderIcon = $derived(
    profile.profile.genderIdentityKind === 'woman'
      ? mdiGenderFemale
      : profile.profile.genderIdentityKind === 'man'
        ? mdiGenderMale
        : profile.profile.genderIdentityKind === 'non_binary'
          ? mdiGenderNonBinary
          : profile.profile.genderIdentityKind === 'self_described'
            ? mdiGenderMaleFemaleVariant
            : mdiHelpCircleOutline,
  );

  const itemHref = (item: CimmichPersonProfileItem) => {
    const value = item.value?.trim();
    if (!value) {
      return undefined;
    }
    if (item.kind === 'email') {
      return `mailto:${value}`;
    }
    if (item.kind === 'phone') {
      return `tel:${value}`;
    }
    if (item.kind === 'web') {
      return /^https?:\/\//i.test(value) ? value : `https://${value}`;
    }
    if (item.kind === 'social') {
      if (/^https?:\/\//i.test(value)) {
        return value;
      }
      const handle = value.replace(/^@/, '');
      if (!handle || /\s/.test(handle)) {
        return undefined;
      }
      const label = item.label.toLowerCase();
      if (label === 'instagram') {
        return `https://instagram.com/${handle}`;
      }
      if (label === 'facebook') {
        return `https://facebook.com/${handle}`;
      }
      if (label === 'linkedin') {
        return `https://linkedin.com/in/${handle}`;
      }
      if (label === 'tiktok') {
        return `https://tiktok.com/@${handle}`;
      }
      if (label === 'x') {
        return `https://x.com/${handle}`;
      }
      if (label === 'mastodon') {
        const match = /^@?([^@]+)@([^@]+)$/.exec(value);
        return match ? `https://${match[2]}/@${match[1]}` : undefined;
      }
      return undefined;
    }
    return undefined;
  };

  const defaultItemLabel = (kind: CimmichPersonProfileItemKind) =>
    kind === 'important_date'
      ? 'Birthday'
      : kind === 'work'
        ? 'Current role'
        : kind === 'email'
          ? 'Personal'
          : kind === 'phone'
            ? 'Mobile'
            : kind === 'address'
              ? 'Home'
              : kind === 'social'
                ? 'Instagram'
                : kind === 'web'
                  ? 'Personal'
                  : 'Detail';

  const labelSuggestions = (kind: CimmichPersonProfileItemKind) =>
    kind === 'important_date'
      ? ['Birthday', 'Anniversary', 'Memorial', 'Other']
      : kind === 'work'
        ? ['Current role', 'Previous role', 'Volunteer', 'Education']
        : kind === 'email'
          ? ['Personal', 'Work', 'Other']
          : kind === 'phone'
            ? ['Mobile', 'Home', 'Work', 'Other']
            : kind === 'social'
              ? ['Instagram', 'Facebook', 'LinkedIn', 'TikTok', 'X', 'Mastodon', 'Other']
              : kind === 'web'
                ? ['Personal', 'Portfolio', 'Business', 'Other']
                : kind === 'address'
                  ? ['Home', 'Work', 'Previous', 'Other']
                  : [];

  const itemLabelTitle = $derived(
    itemKindDraft === 'important_date'
      ? 'Occasion'
      : itemKindDraft === 'work'
        ? 'Type'
        : itemKindDraft === 'social'
          ? 'Platform'
          : 'Label',
  );
  const itemValueTitle = $derived(
    itemKindDraft === 'work'
      ? 'Role or title'
      : itemKindDraft === 'email'
        ? 'Email address'
        : itemKindDraft === 'phone'
          ? 'Phone number'
          : itemKindDraft === 'social'
            ? 'Profile URL or @username'
            : itemKindDraft === 'web'
              ? 'Website address'
              : itemKindDraft === 'address'
                ? 'Address'
                : 'Detail',
  );
  const itemValuePlaceholder = $derived(
    itemKindDraft === 'work'
      ? 'e.g. Designer'
      : itemKindDraft === 'email'
        ? 'name@example.com'
        : itemKindDraft === 'phone'
          ? 'e.g. +61 400 000 000'
          : itemKindDraft === 'social'
            ? 'e.g. @username or profile URL'
            : itemKindDraft === 'web'
              ? 'https://example.com'
              : itemKindDraft === 'address'
                ? 'Street, city, region'
                : 'What would you like to remember?',
  );

  const selectItemKind = (kind: CimmichPersonProfileItemKind) => {
    itemKindDraft = kind;
    if (!itemLabelDraft.trim() || itemKindOptions.some((option) => defaultItemLabel(option.kind) === itemLabelDraft)) {
      itemLabelDraft = defaultItemLabel(kind);
    }
    itemFieldError = undefined;
  };

  const itemValueType = $derived(
    itemKindDraft === 'email' ? 'email' : itemKindDraft === 'phone' ? 'tel' : itemKindDraft === 'web' ? 'url' : 'text',
  );
  const itemValueAutocomplete = $derived(
    itemKindDraft === 'email'
      ? 'email'
      : itemKindDraft === 'phone'
        ? 'tel'
        : itemKindDraft === 'web'
          ? 'url'
          : itemKindDraft === 'address'
            ? 'street-address'
            : 'off',
  );

  const profileErrorMessage = (error: unknown) => {
    if (!(error instanceof CimmichServiceError)) {
      return error instanceof Error ? error.message : 'Unable to save this profile';
    }
    if (error.code === 'PERSON_PROFILE_COMMAND_CONFLICT') {
      return 'This save command was already used for another change.';
    }
    if (error.code === 'PERSON_PROFILE_GENDER_INVALID') {
      return 'Check the gender identity and self-described label.';
    }
    if (error.code === 'PERSON_PROFILE_ITEM_CONFLICT') {
      return 'That detail ID is already in use and cannot be reused.';
    }
    if (error.code === 'PERSON_PROFILE_ITEM_NOT_FOUND') {
      return 'That detail is no longer active. Reload and try again.';
    }
    if (error.code === 'PERSON_PROFILE_DISPLAY_INVALID') {
      return 'Hero display settings are incomplete or invalid.';
    }
    if (error.code === 'PERSON_PROFILE_RELATIONSHIPS_INVALID') {
      return 'One of the selected relationships is unavailable.';
    }
    if (error.code === 'PERSON_PROFILE_VALUE_INVALID' || error.code === 'PERSON_PROFILE_ITEM_INVALID') {
      return 'Check the highlighted values and their length.';
    }
    return error.message;
  };

  const resetItemDraft = () => {
    itemDateDraft = '';
    itemEditId = '';
    itemKindDraft = 'important_date';
    itemLabelDraft = defaultItemLabel('important_date');
    itemSecondaryDraft = '';
    itemValueDraft = '';
    itemFieldError = undefined;
  };

  const loadProfileDraft = () => {
    aboutDraft = profile.profile.about ?? '';
    genderKindDraft = profile.profile.genderIdentityKind;
    genderLabelDraft = profile.profile.genderIdentityLabel ?? '';
    privateNotesDraft = profile.profile.privateNotes ?? '';
    pronounsDraft = profile.profile.pronounsLabel ?? '';
    relationshipDraft = profile.relationships.map(({ categoryId }) => categoryId);
    itemsDraft = profile.items.map((item) => ({ ...item }));
    genderFieldError = '';
    inlineError = '';
    removeConfirmId = '';
    resetItemDraft();
  };

  const focusEditTarget = async (target?: ProfileEditTarget) => {
    await tick();
    switch (target) {
      case 'about': {
        aboutEditorElement?.focus();
        break;
      }
      case 'at_a_glance': {
        relationshipEditorElement?.querySelector<HTMLButtonElement>('button')?.focus();
        break;
      }
      case 'private_notes': {
        privateNotesEditorElement?.focus();
        break;
      }
      case undefined: {
        break;
      }
      default: {
        itemEditorElement?.querySelector<HTMLInputElement>('input')?.focus();
      }
    }
  };

  const startInlineEditing = async (target: ProfileEditTarget) => {
    loadProfileDraft();
    inlineTarget = target;
    message = '';
    errorMessage = '';
    if (target === 'contact') {
      itemKindDraft = profile.items.find(({ kind }) => contactKinds.includes(kind))?.kind ?? 'phone';
      itemLabelDraft = defaultItemLabel(itemKindDraft);
    } else if (sectionOrder.has(target as CimmichPersonProfileItemKind)) {
      itemKindDraft = target as CimmichPersonProfileItemKind;
      itemLabelDraft = defaultItemLabel(itemKindDraft);
    }
    await focusEditTarget(target);
  };

  export function openQuickDetail(
    target: 'address' | 'contact' | 'important_date' | 'private_notes' | 'social' | 'work',
  ) {
    void startInlineEditing(target);
  }

  export function toggleDetailsSettings() {
    if (detailsSettingsOpen) {
      closeDetailsSettings();
    } else {
      openDetailsSettings();
    }
  }

  const startEditing = async (view: EditorView = 'profile', target?: ProfileEditTarget) => {
    detailsSettingsOpen = false;
    loadProfileDraft();
    globalVisibilityDraft = Object.fromEntries(
      defaults.fields.map(({ fieldKey, visible }) => [fieldKey, visible]),
    ) as Record<CimmichPersonProfileFieldKey, boolean>;
    personVisibilityDraft = Object.fromEntries(
      display.fields.map(({ fieldKey, visibility }) => [fieldKey, visibility]),
    ) as Record<CimmichPersonProfileFieldKey, Visibility>;
    editorView = view;
    editing = true;
    errorMessage = '';
    message = '';
    if (target && sectionOrder.has(target as CimmichPersonProfileItemKind)) {
      itemKindDraft = target as CimmichPersonProfileItemKind;
      itemLabelDraft = defaultItemLabel(itemKindDraft);
    }
    await focusEditTarget(target);
  };

  $effect(() => {
    if (startInEdit && !startInEditHandled) {
      startInEditHandled = true;
      void startEditing('profile');
    }
  });

  const toggleRelationship = (categoryId: string) => {
    relationshipDraft = relationshipDraft.includes(categoryId)
      ? relationshipDraft.filter((id) => id !== categoryId)
      : [...relationshipDraft, categoryId];
  };

  const cancelEditing = () => {
    editing = false;
    errorMessage = '';
    genderFieldError = '';
    removeConfirmId = '';
    resetItemDraft();
  };

  const cancelInlineEditing = () => {
    inlineTarget = undefined;
    inlineError = '';
    genderFieldError = '';
    removeConfirmId = '';
    resetItemDraft();
  };

  const buildItemCommands = (onlyKinds?: CimmichPersonProfileItemKind[]) => {
    const originalItems = onlyKinds ? profile.items.filter((item) => onlyKinds.includes(item.kind)) : profile.items;
    const draftItems = onlyKinds ? itemsDraft.filter((item) => onlyKinds.includes(item.kind)) : itemsDraft;
    const originalById = new Map(originalItems.map((item) => [item.itemId, item]));
    const draftById = new Map(draftItems.map((item) => [item.itemId, item]));
    const itemCommands: CimmichPersonProfileItemCommand[] = [];
    for (const original of originalItems) {
      if (!draftById.has(original.itemId)) {
        itemCommands.push({ action: 'remove', itemId: original.itemId });
      }
    }
    for (const item of draftItems) {
      const original = originalById.get(item.itemId);
      if (!original) {
        const { revision: _, ...nextItem } = item;
        itemCommands.push({ action: 'add', item: nextItem });
      } else if (
        original.dateValue !== item.dateValue ||
        original.label !== item.label ||
        original.secondaryValue !== item.secondaryValue ||
        original.value !== item.value
      ) {
        itemCommands.push({
          action: 'update',
          itemId: item.itemId,
          patch: {
            dateValue: item.dateValue,
            label: item.label,
            secondaryValue: item.secondaryValue,
            value: item.value,
          },
        });
      }
    }
    return itemCommands;
  };

  const saveInlineSection = async () => {
    const target = inlineTarget;
    if (!target) {
      return;
    }
    if (target === 'at_a_glance' && genderKindDraft === 'self_described' && !genderLabelDraft.trim()) {
      genderFieldError = 'Describe this person’s gender identity.';
      return;
    }

    const input: CimmichPersonProfilePatch = {
      commandId: createCimmichPersonProfileCommandId(`save-${target.replaceAll('_', '-')}`),
    };
    let changed: boolean;
    switch (target) {
      case 'about': {
        input.about = aboutDraft.trim() || null;
        changed = input.about !== profile.profile.about;
        break;
      }
      case 'at_a_glance': {
        input.genderIdentityKind = genderKindDraft;
        input.genderIdentityLabel = genderKindDraft === 'self_described' ? genderLabelDraft.trim() || null : null;
        input.pronounsLabel = pronounsDraft.trim() || null;
        input.relationshipCategoryIds = relationshipDraft;
        changed =
          input.genderIdentityKind !== profile.profile.genderIdentityKind ||
          input.genderIdentityLabel !== profile.profile.genderIdentityLabel ||
          input.pronounsLabel !== profile.profile.pronounsLabel ||
          relationshipDraft.join('|') !== profile.relationships.map(({ categoryId }) => categoryId).join('|');
        break;
      }
      case 'private_notes': {
        input.privateNotes = privateNotesDraft.trim() || null;
        changed = input.privateNotes !== profile.profile.privateNotes;
        break;
      }
      default: {
        const hasPendingItem = Boolean(
          itemEditId || (itemKindDraft === 'important_date' ? itemDateDraft : itemValueDraft.trim()),
        );
        if (hasPendingItem && !saveItem()) {
          return;
        }
        const itemCommands = buildItemCommands(target === 'contact' ? contactKinds : [target]);
        changed = itemCommands.length > 0;
        if (changed) {
          input.itemCommands = itemCommands;
        }
      }
    }

    if (!changed) {
      cancelInlineEditing();
      return;
    }

    busy = `inline-${target}`;
    inlineError = '';
    try {
      const result = await patchCimmichPersonProfile(profile.person.personId, input);
      onprofilechange(result.profile);
      message = result.replayed
        ? 'Already saved.'
        : `${target === 'at_a_glance' ? 'At a glance' : target === 'private_notes' ? 'Notes' : target === 'about' ? 'About' : target === 'contact' ? 'Contact details' : sectionLabels[target]} saved.`;
      inlineTarget = undefined;
    } catch (error) {
      inlineError = profileErrorMessage(error);
    } finally {
      busy = '';
    }
  };

  const saveProfile = async () => {
    if (genderKindDraft === 'self_described' && !genderLabelDraft.trim()) {
      genderFieldError = 'Describe this person’s gender identity.';
      return;
    }
    busy = 'profile';
    errorMessage = '';
    genderFieldError = '';
    message = '';
    try {
      const itemCommands = buildItemCommands();
      const result = await patchCimmichPersonProfile(profile.person.personId, {
        about: aboutDraft.trim() || null,
        commandId: createCimmichPersonProfileCommandId('save-profile'),
        genderIdentityKind: genderKindDraft,
        genderIdentityLabel: genderKindDraft === 'self_described' ? genderLabelDraft.trim() || null : null,
        ...(itemCommands.length > 0 ? { itemCommands } : {}),
        privateNotes: privateNotesDraft.trim() || null,
        pronounsLabel: pronounsDraft.trim() || null,
        relationshipCategoryIds: relationshipDraft,
      });
      onprofilechange(result.profile);
      message = result.replayed ? 'Profile already saved.' : 'Profile saved.';
      editing = false;
    } catch (error) {
      errorMessage = profileErrorMessage(error);
    } finally {
      busy = '';
    }
  };

  const saveDisplay = async () => {
    busy = 'display';
    errorMessage = '';
    message = '';
    try {
      const result = await patchCimmichPersonProfileDisplay(
        profile.person.personId,
        createCimmichPersonProfileCommandId('person-display'),
        display.fields.map(({ fieldKey }) => ({ fieldKey, visibility: personVisibilityDraft[fieldKey] })),
      );
      ondisplaychange(result.display);
      message = 'Hero display saved.';
      editing = false;
    } catch (error) {
      errorMessage = profileErrorMessage(error);
    } finally {
      busy = '';
    }
  };

  const saveDefaults = async () => {
    busy = 'defaults';
    errorMessage = '';
    message = '';
    try {
      const result = await patchCimmichPersonProfileDisplayDefaults(
        createCimmichPersonProfileCommandId('display-defaults'),
        defaults.fields
          .map((field) => ({ ...field, visible: globalVisibilityDraft[field.fieldKey] }))
          .sort((left, right) => left.order - right.order),
      );
      ondefaultschange(result.defaults);
      message = 'People defaults saved.';
      editing = false;
    } catch (error) {
      errorMessage = profileErrorMessage(error);
    } finally {
      busy = '';
    }
  };

  const saveDetailsDisplay = async () => {
    busy = 'details-display';
    errorMessage = '';
    message = '';
    try {
      const result = await patchCimmichPersonDetailsDisplay(
        profile.person.personId,
        createCimmichPersonProfileCommandId('details-display'),
        detailsDisplay.sections.map(({ sectionKey }) => ({
          sectionKey,
          visibility: detailsPersonDraft[sectionKey],
        })),
      );
      ondetailsdisplaychange(result.display);
      message = result.replayed ? 'These Details choices were already saved.' : 'Details choices saved.';
      detailsSettingsOpen = false;
    } catch (error) {
      errorMessage = profileErrorMessage(error);
    } finally {
      busy = '';
    }
  };

  const saveDetailsDefaults = async () => {
    busy = 'details-defaults';
    errorMessage = '';
    message = '';
    try {
      const result = await patchCimmichPersonDetailsDisplayDefaults(
        createCimmichPersonProfileCommandId('details-defaults'),
        detailsDefaults.sections
          .map((section) => ({ ...section, visible: detailsDefaultDraft[section.sectionKey] }))
          .sort((left, right) => left.order - right.order),
      );
      ondetailsdefaultschange(result.defaults);
      ondetailsdisplaychange({
        ...detailsDisplay,
        sections: detailsDisplay.sections.map((section) => {
          const defaultVisible = detailsDefaultDraft[section.sectionKey];
          return {
            ...section,
            defaultVisible,
            effectiveVisible: section.visibility === 'inherit' ? defaultVisible : section.visibility === 'show',
          };
        }),
      });
      message = result.replayed ? 'These People defaults were already saved.' : 'Details defaults saved.';
      detailsSettingsOpen = false;
    } catch (error) {
      errorMessage = profileErrorMessage(error);
    } finally {
      busy = '';
    }
  };

  const editItem = (item: CimmichPersonProfileItem) => {
    itemDateDraft = item.dateValue ?? '';
    itemEditId = item.itemId;
    itemKindDraft = item.kind;
    itemLabelDraft = item.label;
    itemSecondaryDraft = item.secondaryValue ?? '';
    itemValueDraft = item.value ?? '';
    errorMessage = '';
    itemFieldError = undefined;
    removeConfirmId = '';
  };

  const saveItem = () => {
    if (!itemLabelDraft.trim()) {
      itemFieldError = { field: 'label', message: `Choose or enter a ${itemLabelTitle.toLowerCase()}.` };
      return false;
    }
    if (itemKindDraft === 'important_date' ? !itemDateDraft : !itemValueDraft.trim()) {
      itemFieldError = {
        field: itemKindDraft === 'important_date' ? 'date' : 'value',
        message: itemKindDraft === 'important_date' ? 'Choose a date.' : `Enter the ${itemValueTitle.toLowerCase()}.`,
      };
      return false;
    }
    itemFieldError = undefined;
    const nextItem: CimmichPersonProfileItem = {
      dateValue: itemKindDraft === 'important_date' ? itemDateDraft : null,
      itemId: itemEditId || createCimmichPersonProfileItemId(),
      kind: itemKindDraft,
      label: itemLabelDraft.trim(),
      revision: itemEditId ? (itemsDraft.find((item) => item.itemId === itemEditId)?.revision ?? 0) : 0,
      secondaryValue: itemKindDraft === 'work' ? itemSecondaryDraft.trim() || null : null,
      value: itemKindDraft === 'important_date' ? null : itemValueDraft.trim(),
    };
    itemsDraft = itemEditId
      ? itemsDraft.map((item) => (item.itemId === itemEditId ? nextItem : item))
      : [...itemsDraft, nextItem];
    message = itemEditId ? 'Detail ready to save.' : 'Detail added to this draft.';
    resetItemDraft();
    return true;
  };

  const removeItem = (itemId: string) => {
    if (removeConfirmId !== itemId) {
      removeConfirmId = itemId;
      return;
    }
    errorMessage = '';
    itemsDraft = itemsDraft.filter((item) => item.itemId !== itemId);
    message = 'Detail removed from this draft.';
    removeConfirmId = '';
    if (itemEditId === itemId) {
      resetItemDraft();
    }
  };

  const displayItemValue = (item: CimmichPersonProfileItem) =>
    item.kind === 'important_date'
      ? new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'long', timeZone: 'UTC', year: 'numeric' }).format(
          new Date(`${item.dateValue}T00:00:00Z`),
        )
      : item.value;
</script>

{#snippet inlineActions(sectionName: string)}
  {#if inlineError}
    <p
      class="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
      role="alert"
    >
      {inlineError}
    </p>
  {/if}
  <div class="flex flex-wrap justify-end gap-2 border-t border-gray-200 pt-4 dark:border-immich-dark-gray">
    <button
      class="min-h-11 rounded-lg px-4 text-sm font-semibold text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/10"
      type="button"
      disabled={Boolean(busy)}
      onclick={cancelInlineEditing}>Cancel</button
    >
    <button
      class="inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-white disabled:opacity-50 dark:bg-immich-dark-primary dark:text-black"
      type="button"
      disabled={Boolean(busy)}
      onclick={() => void saveInlineSection()}
    >
      <Icon icon={mdiContentSaveOutline} size="18" />
      {busy.startsWith('inline-') ? 'Saving…' : `Save ${sectionName}`}
    </button>
  </div>
{/snippet}

{#snippet inlineItemEditor(kinds: CimmichPersonProfileItemKind[], sectionName: string)}
  {@const sectionDraftItems = itemsDraft.filter((item) => kinds.includes(item.kind))}
  <div class="grid gap-4" bind:this={itemEditorElement}>
    {#if sectionDraftItems.length > 0}
      <div class="grid gap-2">
        {#each sectionDraftItems as item (item.itemId)}
          <div
            class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-200 px-3 py-2 dark:border-immich-dark-gray"
          >
            <div class="min-w-0">
              <p class="text-xs font-medium text-gray-500 dark:text-gray-400">{item.label}</p>
              <p class="text-sm font-semibold wrap-break-word">
                {displayItemValue(item)}{item.secondaryValue ? ` · ${item.secondaryValue}` : ''}
              </p>
            </div>
            <div class="flex gap-1">
              <button
                class="flex size-11 items-center justify-center rounded-lg text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/10"
                type="button"
                aria-label={`Edit ${item.label}`}
                disabled={Boolean(busy)}
                onclick={() => editItem(item)}><Icon icon={mdiPencilOutline} size="18" /></button
              >
              <button
                class={`flex min-h-11 items-center justify-center rounded-lg px-3 text-sm font-semibold ${removeConfirmId === item.itemId ? 'bg-red-600 text-white' : 'text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950'}`}
                type="button"
                aria-label={removeConfirmId === item.itemId ? `Confirm remove ${item.label}` : `Remove ${item.label}`}
                disabled={Boolean(busy)}
                onclick={() => void removeItem(item.itemId)}
              >
                <Icon icon={mdiTrashCanOutline} size="18" />
                {#if removeConfirmId === item.itemId}<span class="ml-1">Confirm</span>{/if}
              </button>
            </div>
          </div>
        {/each}
      </div>
    {/if}

    <div class="grid gap-3 rounded-xl bg-gray-50 p-4 dark:bg-white/5">
      <h4 class="font-semibold">
        {itemEditId
          ? `Edit ${itemLabelDraft}`
          : sectionName === 'Contact details'
            ? 'Add contact detail'
            : `Add ${sectionName.toLowerCase()}`}
      </h4>
      {#if kinds.length > 1 && !itemEditId}
        <fieldset class="grid gap-2">
          <legend class="text-xs font-semibold text-gray-600 dark:text-gray-300">Contact type</legend>
          <div class="flex flex-wrap gap-2">
            {#each itemKindOptions.filter(({ kind }) => kinds.includes(kind)) as option (option.kind)}
              <button
                class="min-h-11 rounded-full border px-4 text-sm font-semibold transition {itemKindDraft === option.kind
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-gray-300 bg-white hover:border-gray-500 dark:border-immich-dark-gray dark:bg-immich-dark-bg'}"
                type="button"
                aria-pressed={itemKindDraft === option.kind}
                onclick={() => selectItemKind(option.kind)}>{option.label}</button
              >
            {/each}
          </div>
        </fieldset>
      {/if}
      {#if labelSuggestions(itemKindDraft).length > 0}
        <fieldset class="grid gap-2">
          <legend class="text-xs font-semibold text-gray-600 dark:text-gray-300">{itemLabelTitle} suggestions</legend>
          <div class="flex flex-wrap gap-2">
            {#each labelSuggestions(itemKindDraft) as suggestion (suggestion)}
              <button
                class="min-h-9 rounded-full border px-3 text-xs font-semibold transition {itemLabelDraft === suggestion
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-gray-300 bg-white hover:border-gray-500 dark:border-immich-dark-gray dark:bg-immich-dark-bg'}"
                type="button"
                aria-pressed={itemLabelDraft === suggestion}
                onclick={() => {
                  itemLabelDraft = suggestion;
                  if (itemFieldError?.field === 'label') {
                    itemFieldError = undefined;
                  }
                }}>{suggestion}</button
              >
            {/each}
          </div>
        </fieldset>
      {/if}
      <div class="grid gap-3 sm:grid-cols-2">
        <label class="grid gap-1 text-xs font-semibold text-gray-600 dark:text-gray-300">
          {itemLabelTitle}
          <input
            class="min-h-11 rounded-lg border bg-white px-3 text-sm font-normal text-immich-fg outline-none focus:ring-2 focus:ring-primary/20 dark:bg-immich-dark-bg dark:text-immich-dark-fg {itemFieldError?.field ===
            'label'
              ? 'border-red-500 focus:border-red-500'
              : 'border-gray-300 focus:border-primary dark:border-immich-dark-gray'}"
            maxlength="80"
            aria-invalid={itemFieldError?.field === 'label'}
            aria-describedby={itemFieldError?.field === 'label' ? 'inline-detail-label-error' : undefined}
            bind:value={itemLabelDraft}
            oninput={() => {
              if (itemFieldError?.field === 'label') {
                itemFieldError = undefined;
              }
            }}
          />
          {#if itemFieldError?.field === 'label'}
            <span class="text-xs font-medium text-red-600 dark:text-red-300" id="inline-detail-label-error" role="alert"
              >{itemFieldError.message}</span
            >
          {/if}
        </label>
        {#if itemKindDraft === 'important_date'}
          <label class="grid gap-1 text-xs font-semibold text-gray-600 dark:text-gray-300">
            Date
            <input
              class="min-h-11 rounded-lg border bg-white px-3 text-sm font-normal text-immich-fg dark:bg-immich-dark-bg dark:text-immich-dark-fg {itemFieldError?.field ===
              'date'
                ? 'border-red-500 focus:border-red-500'
                : 'border-gray-300 focus:border-primary dark:border-immich-dark-gray'}"
              type="date"
              aria-invalid={itemFieldError?.field === 'date'}
              aria-describedby={itemFieldError?.field === 'date' ? 'inline-detail-date-error' : undefined}
              bind:value={itemDateDraft}
              oninput={() => {
                if (itemFieldError?.field === 'date') {
                  itemFieldError = undefined;
                }
              }}
            />
            {#if itemFieldError?.field === 'date'}
              <span
                class="text-xs font-medium text-red-600 dark:text-red-300"
                id="inline-detail-date-error"
                role="alert">{itemFieldError.message}</span
              >
            {/if}
          </label>
        {:else}
          <label class="grid gap-1 text-xs font-semibold text-gray-600 dark:text-gray-300">
            {itemValueTitle}
            <input
              class="min-h-11 rounded-lg border bg-white px-3 text-sm font-normal text-immich-fg outline-none focus:ring-2 focus:ring-primary/20 dark:bg-immich-dark-bg dark:text-immich-dark-fg {itemFieldError?.field ===
              'value'
                ? 'border-red-500 focus:border-red-500'
                : 'border-gray-300 focus:border-primary dark:border-immich-dark-gray'}"
              type={itemValueType}
              autocomplete={itemValueAutocomplete}
              placeholder={itemValuePlaceholder}
              aria-invalid={itemFieldError?.field === 'value'}
              aria-describedby={itemFieldError?.field === 'value' ? 'inline-detail-value-error' : undefined}
              bind:value={itemValueDraft}
              oninput={() => {
                if (itemFieldError?.field === 'value') {
                  itemFieldError = undefined;
                }
              }}
            />
            {#if itemFieldError?.field === 'value'}
              <span
                class="text-xs font-medium text-red-600 dark:text-red-300"
                id="inline-detail-value-error"
                role="alert">{itemFieldError.message}</span
              >
            {/if}
          </label>
          {#if itemKindDraft === 'work'}
            <label class="grid gap-1 text-xs font-semibold text-gray-600 dark:text-gray-300">
              Organisation
              <input
                class="min-h-11 rounded-lg border border-gray-300 bg-white px-3 text-sm font-normal text-immich-fg outline-none focus:border-primary dark:border-immich-dark-gray dark:bg-immich-dark-bg dark:text-immich-dark-fg"
                bind:value={itemSecondaryDraft}
              />
            </label>
          {/if}
        {/if}
      </div>
      <div class="flex flex-wrap gap-2">
        <button
          class="inline-flex min-h-11 items-center gap-2 rounded-lg border border-primary px-4 text-sm font-semibold text-primary hover:bg-primary/5 dark:text-immich-dark-primary"
          type="button"
          disabled={Boolean(busy)}
          onclick={() => void saveItem()}
        >
          <Icon icon={itemEditId ? mdiContentSaveOutline : mdiPlus} size="18" />
          {itemEditId ? 'Update detail' : 'Add detail'}
        </button>
        {#if itemEditId}
          <button
            class="min-h-11 rounded-lg px-4 text-sm font-semibold text-gray-600 hover:bg-gray-200 dark:text-gray-300 dark:hover:bg-white/10"
            type="button"
            disabled={Boolean(busy)}
            onclick={resetItemDraft}>Cancel edit</button
          >
        {/if}
      </div>
    </div>
    {@render inlineActions(sectionName)}
  </div>
{/snippet}

{#snippet itemSectionCard(kind: CimmichPersonProfileItemKind)}
  {@const sectionItems = profile.items.filter((item) => item.kind === kind)}
  <article
    class={`dossier-card dossier-card--${kind} rounded-2xl border border-gray-200 p-5 dark:border-immich-dark-gray ${inlineTarget === kind ? 'md:col-span-2' : ''}`}
    data-dossier-section={dossierSectionNumbers[kind]}
  >
    <div class="flex items-start justify-between gap-3">
      <div class="flex items-center gap-2">
        <span
          class="dossier-icon flex size-8 items-center justify-center rounded-xl bg-gray-100 text-gray-600 dark:bg-white/5 dark:text-gray-300"
          aria-hidden="true"
        >
          <Icon icon={sectionIcons[kind]} size="18" />
        </span>
        <h3 class="font-semibold">{sectionLabels[kind]}</h3>
      </div>
      {#if inlineTarget !== kind}
        <button
          class={sectionItems.length > 0
            ? 'flex size-11 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary dark:text-gray-400 dark:hover:bg-white/10 dark:hover:text-immich-dark-primary'
            : 'inline-flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm font-semibold text-primary hover:bg-primary/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary dark:text-immich-dark-primary'}
          type="button"
          aria-label={`${sectionItems.length > 0 ? 'Edit' : 'Add'} ${sectionLabels[kind]}`}
          title={`${sectionItems.length > 0 ? 'Edit' : 'Add'} ${sectionLabels[kind]}`}
          disabled={Boolean(inlineTarget)}
          onclick={() => void startInlineEditing(kind)}
        >
          <Icon icon={sectionItems.length > 0 ? mdiPencilOutline : mdiPlus} size="18" />
          {#if sectionItems.length === 0}<span>Add</span>{/if}
        </button>
      {/if}
    </div>
    {#if inlineTarget === kind}
      <div class="mt-4">
        {@render inlineItemEditor([kind], sectionLabels[kind])}
      </div>
    {:else if sectionItems.length > 0}
      {#if kind === 'important_date'}
        <ol class="dossier-timeline mt-4 grid gap-4" aria-label="Important dates">
          {#each sectionItems as item (item.itemId)}
            <li>
              <span class="dossier-field-label">{item.label}</span>
              <time class="mt-1 block font-semibold" datetime={item.dateValue ?? undefined}
                >{displayItemValue(item)}</time
              >
            </li>
          {/each}
        </ol>
      {:else if kind === 'work'}
        <div class="dossier-work-list mt-4 grid gap-3">
          {#each sectionItems as item (item.itemId)}
            <section class="dossier-work-entry" aria-label={item.label}>
              <span class="dossier-field-label">{item.label}</span>
              <p class="mt-1 text-base font-semibold wrap-break-word">{displayItemValue(item)}</p>
              {#if item.secondaryValue}
                <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">{item.secondaryValue}</p>
              {/if}
            </section>
          {/each}
        </div>
      {:else if kind === 'social'}
        <ul class="dossier-social-list mt-4 grid gap-2" aria-label="Social profiles">
          {#each sectionItems as item (item.itemId)}
            <li>
              {#if itemHref(item)}
                <a class="dossier-social-profile" href={itemHref(item)} target="_blank" rel="noreferrer">
                  <span
                    class="dossier-icon flex size-9 shrink-0 items-center justify-center rounded-full"
                    aria-hidden="true"
                  >
                    <Icon icon={mdiAt} size="18" />
                  </span>
                  <span class="min-w-0">
                    <span class="dossier-field-label block">{item.label}</span>
                    <span class="block truncate font-semibold">{displayItemValue(item)}</span>
                  </span>
                </a>
              {:else}
                <div class="dossier-social-profile">
                  <span
                    class="dossier-icon flex size-9 shrink-0 items-center justify-center rounded-full"
                    aria-hidden="true"
                  >
                    <Icon icon={mdiAt} size="18" />
                  </span>
                  <span class="min-w-0">
                    <span class="dossier-field-label block">{item.label}</span>
                    <span class="block truncate font-semibold">{displayItemValue(item)}</span>
                  </span>
                </div>
              {/if}
            </li>
          {/each}
        </ul>
      {:else if kind === 'address'}
        <div class="dossier-address-list mt-4 grid gap-3">
          {#each sectionItems as item (item.itemId)}
            <address class="dossier-address not-italic">
              <span
                class="dossier-icon flex size-9 shrink-0 items-center justify-center rounded-full"
                aria-hidden="true"
              >
                <Icon icon={mdiMapMarkerOutline} size="18" />
              </span>
              <span>
                <span class="dossier-field-label block">{item.label}</span>
                <span class="mt-1 block font-semibold wrap-break-word">{displayItemValue(item)}</span>
              </span>
            </address>
          {/each}
        </div>
      {/if}
    {:else}
      <p class="dossier-empty mt-4 text-sm text-gray-500 dark:text-gray-400">
        {dossierEmptyPrompts[kind] ?? 'Add something worth remembering.'}
      </p>
    {/if}
  </article>
{/snippet}

<section class="grid gap-5" aria-labelledby="person-details-heading">
  {#if railManaged}
    <h2 id="person-details-heading" class="sr-only">Details</h2>
  {:else}
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 id="person-details-heading" class="text-xl font-semibold">Details</h2>
        {#if compact}
          <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
            What you know about {profile.person.displayName}, with quick ways to fill the gaps.
          </p>
        {/if}
      </div>
      <div class="flex items-center gap-1">
        <button
          class="flex size-11 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary dark:text-gray-400 dark:hover:bg-white/10 dark:hover:text-immich-dark-primary"
          type="button"
          aria-expanded={detailsSettingsOpen}
          aria-controls="person-details-display-settings"
          aria-label="Choose visible Details sections"
          title="Choose visible Details sections"
          onclick={toggleDetailsSettings}
        >
          <Icon icon={mdiEyeSettingsOutline} size="20" />
        </button>
      </div>
    </div>
  {/if}

  <div aria-live="polite">
    {#if message}
      <p class="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:bg-emerald-950 dark:text-emerald-100">
        {message}
      </p>
    {/if}
    {#if errorMessage}
      <p
        class="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
        role="alert"
      >
        {errorMessage}
      </p>
    {/if}
  </div>

  {#if compact && !railManaged && !editing && !detailsSettingsOpen && !inlineTarget}
    <section
      class="rounded-2xl border border-gray-200 bg-gray-50/70 p-4 dark:border-immich-dark-gray dark:bg-white/2.5"
      aria-labelledby="quick-person-details-heading"
    >
      <div class="flex flex-wrap items-center justify-between gap-x-5 gap-y-2">
        <div>
          <h3 class="font-semibold" id="quick-person-details-heading">Add to {profile.person.displayName}</h3>
          <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">Choose a detail and add it right here.</p>
        </div>
        <div class="flex flex-wrap gap-2">
          {#each quickDetailActions as action (action.target)}
            <button
              class="inline-flex min-h-10 items-center gap-2 rounded-full border border-gray-300 bg-white px-3 text-sm font-semibold hover:border-primary hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary dark:border-immich-dark-gray dark:bg-immich-dark-bg dark:hover:border-immich-dark-primary dark:hover:text-immich-dark-primary"
              type="button"
              onclick={() => void startInlineEditing(action.target)}
            >
              <Icon icon={action.icon} size="17" />
              {action.label}
            </button>
          {/each}
        </div>
      </div>
    </section>
  {/if}

  {#if detailsSettingsOpen}
    <section
      class="grid gap-5 rounded-2xl border border-gray-200 bg-white p-5 dark:border-immich-dark-gray dark:bg-immich-dark-bg"
      id="person-details-display-settings"
      aria-labelledby="person-details-display-heading"
    >
      <div>
        <h3 class="font-semibold" id="person-details-display-heading">Choose what appears in Details</h3>
        <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Hide a section without deleting anything saved inside it.
        </p>
      </div>
      <div
        class="grid grid-cols-2 gap-1 rounded-xl bg-gray-100 p-1 sm:w-fit dark:bg-white/5"
        role="tablist"
        aria-label="Details visibility scope"
      >
        <button
          class="min-h-11 rounded-lg px-4 text-sm font-semibold {detailsSettingsView === 'person'
            ? 'bg-white text-primary shadow-sm dark:bg-gray-800 dark:text-immich-dark-primary'
            : 'text-gray-600 hover:text-immich-fg dark:text-gray-300 dark:hover:text-white'}"
          type="button"
          role="tab"
          aria-selected={detailsSettingsView === 'person'}
          onclick={() => (detailsSettingsView = 'person')}>This person</button
        >
        <button
          class="min-h-11 rounded-lg px-4 text-sm font-semibold {detailsSettingsView === 'defaults'
            ? 'bg-white text-primary shadow-sm dark:bg-gray-800 dark:text-immich-dark-primary'
            : 'text-gray-600 hover:text-immich-fg dark:text-gray-300 dark:hover:text-white'}"
          type="button"
          role="tab"
          aria-selected={detailsSettingsView === 'defaults'}
          onclick={() => (detailsSettingsView = 'defaults')}>People defaults</button
        >
      </div>

      {#if detailsSettingsView === 'person'}
        <div class="grid gap-3 sm:grid-cols-2">
          {#each orderedDetailsDisplaySections as section (section.sectionKey)}
            <fieldset class="rounded-xl border border-gray-200 p-4 dark:border-immich-dark-gray">
              <legend class="px-1 text-sm font-semibold">{detailsSectionLabels[section.sectionKey]}</legend>
              <p class="mb-3 text-xs text-gray-500 dark:text-gray-400">
                People default: {section.defaultVisible ? 'shown' : 'hidden'}
              </p>
              <div class="grid grid-cols-3 gap-1 rounded-xl bg-gray-100 p-1 dark:bg-white/5">
                {#each [{ value: 'inherit' as const, label: 'Default' }, { value: 'show' as const, label: 'Show' }, { value: 'hide' as const, label: 'Hide' }] as option (option.value)}
                  <button
                    type="button"
                    class="min-h-11 rounded-lg px-2 text-xs font-semibold transition focus-visible:outline-2 focus-visible:outline-primary {detailsPersonDraft[
                      section.sectionKey
                    ] === option.value
                      ? 'bg-white text-primary shadow-sm dark:bg-gray-800 dark:text-immich-dark-primary'
                      : 'text-gray-600 hover:text-immich-fg dark:text-gray-300 dark:hover:text-white'}"
                    aria-pressed={detailsPersonDraft[section.sectionKey] === option.value}
                    aria-label={`${detailsSectionLabels[section.sectionKey]}: ${option.label}`}
                    onclick={() => (detailsPersonDraft[section.sectionKey] = option.value)}>{option.label}</button
                  >
                {/each}
              </div>
            </fieldset>
          {/each}
        </div>
      {:else}
        <div class="grid gap-3 sm:grid-cols-2">
          {#each orderedDetailsDefaultSections as section (section.sectionKey)}
            <label
              class="flex min-h-14 items-center justify-between gap-4 rounded-xl border border-gray-200 px-4 py-2 dark:border-immich-dark-gray"
            >
              <span class="text-sm font-semibold">{detailsSectionLabels[section.sectionKey]}</span>
              <span class="inline-flex min-h-11 items-center gap-2 text-sm">
                <input
                  class="size-5"
                  type="checkbox"
                  aria-label={`${detailsSectionLabels[section.sectionKey]} shown by default`}
                  bind:checked={detailsDefaultDraft[section.sectionKey]}
                />
                {detailsDefaultDraft[section.sectionKey] ? 'Shown' : 'Hidden'}
              </span>
            </label>
          {/each}
        </div>
      {/if}

      <div
        class="sticky bottom-0 z-10 -mx-5 flex flex-wrap justify-end gap-2 border-t border-gray-200 bg-white/95 px-5 py-4 backdrop-blur-sm dark:border-immich-dark-gray dark:bg-immich-dark-bg/95"
      >
        <button
          class="min-h-11 rounded-lg px-4 text-sm font-semibold text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/10"
          type="button"
          disabled={Boolean(busy)}
          onclick={closeDetailsSettings}>Cancel</button
        >
        <button
          class="inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-white disabled:opacity-50 dark:bg-immich-dark-primary dark:text-black"
          type="button"
          disabled={Boolean(busy)}
          onclick={() => void (detailsSettingsView === 'person' ? saveDetailsDisplay() : saveDetailsDefaults())}
        >
          <Icon icon={mdiContentSaveOutline} size="18" />
          {busy.startsWith('details-')
            ? 'Saving…'
            : detailsSettingsView === 'person'
              ? 'Save for this person'
              : 'Save People defaults'}
        </button>
      </div>
    </section>
  {/if}

  {#if editing}
    <div
      class="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-immich-dark-gray dark:bg-immich-dark-bg"
    >
      <div
        class="flex border-b border-gray-200 p-2 dark:border-immich-dark-gray"
        role="tablist"
        aria-label="Profile editor"
      >
        <button
          class={`min-h-11 rounded-lg px-4 text-sm font-semibold ${editorView === 'profile' ? 'bg-gray-900 text-white dark:bg-white dark:text-black' : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/10'}`}
          type="button"
          role="tab"
          aria-selected={editorView === 'profile'}
          onclick={() => (editorView = 'profile')}>Profile</button
        >
        <button
          class={`min-h-11 rounded-lg px-4 text-sm font-semibold ${editorView === 'display' ? 'bg-gray-900 text-white dark:bg-white dark:text-black' : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/10'}`}
          type="button"
          role="tab"
          aria-selected={editorView === 'display'}
          onclick={() => (editorView = 'display')}>Shown in hero</button
        >
        <button
          class={`min-h-11 rounded-lg px-4 text-sm font-semibold ${editorView === 'defaults' ? 'bg-gray-900 text-white dark:bg-white dark:text-black' : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/10'}`}
          type="button"
          role="tab"
          aria-selected={editorView === 'defaults'}
          onclick={() => (editorView = 'defaults')}>People defaults</button
        >
      </div>

      {#if editorView === 'profile'}
        <div class="grid gap-6 p-5 sm:p-6">
          <label class="grid gap-2 text-sm font-semibold">
            About
            <textarea
              class="min-h-28 resize-y rounded-lg border border-gray-300 bg-transparent px-3 py-2 font-normal outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 dark:border-immich-dark-gray"
              maxlength="4000"
              bind:this={aboutEditorElement}
              bind:value={aboutDraft}
              placeholder="What would you like to remember about this person?"
            ></textarea>
          </label>

          <fieldset class="grid gap-2" bind:this={relationshipEditorElement}>
            <legend class="text-sm font-semibold">Relationship</legend>
            <div class="flex flex-wrap gap-2">
              {#each profile.relationshipCatalog as category (category.categoryId)}
                <button
                  class={`min-h-11 rounded-full border px-4 text-sm font-medium ${relationshipDraft.includes(category.categoryId) ? 'border-primary bg-primary/10 text-primary' : 'border-gray-300 hover:border-gray-500 dark:border-immich-dark-gray'}`}
                  type="button"
                  aria-pressed={relationshipDraft.includes(category.categoryId)}
                  onclick={() => toggleRelationship(category.categoryId)}>{category.name}</button
                >
              {/each}
            </div>
          </fieldset>

          <div class="grid gap-4 sm:grid-cols-2">
            <label class="grid gap-2 text-sm font-semibold">
              Gender identity
              <select
                class="min-h-11 rounded-lg border border-gray-300 bg-transparent px-3 font-normal dark:border-immich-dark-gray dark:bg-immich-dark-bg"
                bind:value={genderKindDraft}
              >
                <option value={null}>Not set</option>
                <option value="woman">Woman</option>
                <option value="man">Man</option>
                <option value="non_binary">Non-binary</option>
                <option value="self_described">Self-described</option>
              </select>
            </label>
            <label class="grid gap-2 text-sm font-semibold">
              Pronouns
              <input
                class="min-h-11 rounded-lg border border-gray-300 bg-transparent px-3 font-normal outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 dark:border-immich-dark-gray"
                maxlength="80"
                bind:value={pronounsDraft}
              />
            </label>
          </div>
          {#if genderKindDraft === 'self_described'}
            <label class="grid gap-2 text-sm font-semibold sm:max-w-md">
              Self-described gender identity
              <input
                class="min-h-11 rounded-lg border bg-transparent px-3 font-normal outline-none focus:ring-2 focus:ring-primary/20 {genderFieldError
                  ? 'border-red-500 focus:border-red-500'
                  : 'border-gray-300 focus:border-primary dark:border-immich-dark-gray'}"
                maxlength="120"
                required
                aria-invalid={Boolean(genderFieldError)}
                aria-describedby={genderFieldError ? 'gender-identity-error' : undefined}
                bind:value={genderLabelDraft}
                oninput={() => (genderFieldError = '')}
              />
              {#if genderFieldError}
                <span class="text-xs font-medium text-red-600 dark:text-red-300" id="gender-identity-error" role="alert"
                  >{genderFieldError}</span
                >
              {/if}
            </label>
          {/if}

          <div class="grid gap-3 rounded-xl bg-gray-50 p-4 dark:bg-white/5" bind:this={itemEditorElement}>
            <div class="flex items-center gap-2">
              <Icon icon={itemEditId ? mdiPencilOutline : mdiPlus} size="19" />
              <h3 class="font-semibold">{itemEditId ? 'Edit detail' : 'Add a detail'}</h3>
            </div>
            <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <fieldset class="grid gap-2 sm:col-span-2 lg:col-span-4" disabled={Boolean(itemEditId)}>
                <legend class="text-xs font-semibold text-gray-600 dark:text-gray-300">Detail type</legend>
                <div class="flex flex-wrap gap-2">
                  {#each itemKindOptions as option (option.kind)}
                    <button
                      class="inline-flex min-h-11 items-center gap-2 rounded-full border px-3 text-xs font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary {itemKindDraft ===
                      option.kind
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-gray-300 hover:border-gray-500 dark:border-immich-dark-gray'}"
                      type="button"
                      aria-pressed={itemKindDraft === option.kind}
                      onclick={() => selectItemKind(option.kind)}
                    >
                      <Icon icon={sectionIcons[option.kind]} size="16" />
                      {option.label}
                    </button>
                  {/each}
                </div>
              </fieldset>
              <div class="grid gap-2 sm:col-span-2 lg:col-span-2">
                {#if labelSuggestions(itemKindDraft).length > 0}
                  <fieldset class="grid gap-2">
                    <legend class="text-xs font-semibold text-gray-600 dark:text-gray-300">
                      {itemLabelTitle} suggestions
                    </legend>
                    <div class="flex flex-wrap gap-2">
                      {#each labelSuggestions(itemKindDraft) as suggestion (suggestion)}
                        <button
                          class="min-h-9 rounded-full border px-3 text-xs font-semibold transition {itemLabelDraft ===
                          suggestion
                            ? 'border-primary bg-primary/10 text-primary'
                            : 'border-gray-300 bg-white hover:border-gray-500 dark:border-immich-dark-gray dark:bg-immich-dark-bg'}"
                          type="button"
                          aria-pressed={itemLabelDraft === suggestion}
                          onclick={() => {
                            itemLabelDraft = suggestion;
                            if (itemFieldError?.field === 'label') {
                              itemFieldError = undefined;
                            }
                          }}>{suggestion}</button
                        >
                      {/each}
                    </div>
                  </fieldset>
                {/if}
                <label class="grid gap-1 text-xs font-semibold text-gray-600 dark:text-gray-300">
                  {itemLabelTitle}
                  <input
                    class="min-h-11 rounded-lg border bg-white px-3 text-sm font-normal text-immich-fg outline-none focus:ring-2 focus:ring-primary/20 dark:bg-immich-dark-bg dark:text-immich-dark-fg {itemFieldError?.field ===
                    'label'
                      ? 'border-red-500 focus:border-red-500'
                      : 'border-gray-300 focus:border-primary dark:border-immich-dark-gray'}"
                    maxlength="80"
                    aria-invalid={itemFieldError?.field === 'label'}
                    aria-describedby={itemFieldError?.field === 'label' ? 'detail-label-error' : undefined}
                    bind:value={itemLabelDraft}
                    oninput={() => {
                      if (itemFieldError?.field === 'label') {
                        itemFieldError = undefined;
                      }
                    }}
                  />
                  {#if itemFieldError?.field === 'label'}
                    <span
                      class="text-xs font-medium text-red-600 dark:text-red-300"
                      id="detail-label-error"
                      role="alert">{itemFieldError.message}</span
                    >
                  {/if}
                </label>
              </div>
              {#if itemKindDraft === 'important_date'}
                <label class="grid gap-1 text-xs font-semibold text-gray-600 lg:col-span-2 dark:text-gray-300">
                  Date
                  <input
                    class="min-h-11 rounded-lg border bg-white px-3 text-sm font-normal text-immich-fg dark:bg-immich-dark-bg dark:text-immich-dark-fg {itemFieldError?.field ===
                    'date'
                      ? 'border-red-500 focus:border-red-500'
                      : 'border-gray-300 focus:border-primary dark:border-immich-dark-gray'}"
                    type="date"
                    aria-invalid={itemFieldError?.field === 'date'}
                    aria-describedby={itemFieldError?.field === 'date' ? 'detail-date-error' : undefined}
                    bind:value={itemDateDraft}
                    oninput={() => {
                      if (itemFieldError?.field === 'date') {
                        itemFieldError = undefined;
                      }
                    }}
                  />
                  {#if itemFieldError?.field === 'date'}
                    <span class="text-xs font-medium text-red-600 dark:text-red-300" id="detail-date-error" role="alert"
                      >{itemFieldError.message}</span
                    >
                  {/if}
                </label>
              {:else}
                <label
                  class={`grid gap-1 text-xs font-semibold text-gray-600 dark:text-gray-300 ${itemKindDraft === 'work' ? '' : 'lg:col-span-2'}`}
                >
                  {itemValueTitle}
                  <input
                    class="min-h-11 rounded-lg border bg-white px-3 text-sm font-normal text-immich-fg outline-none focus:ring-2 focus:ring-primary/20 dark:bg-immich-dark-bg dark:text-immich-dark-fg {itemFieldError?.field ===
                    'value'
                      ? 'border-red-500 focus:border-red-500'
                      : 'border-gray-300 focus:border-primary dark:border-immich-dark-gray'}"
                    type={itemValueType}
                    autocomplete={itemValueAutocomplete}
                    placeholder={itemValuePlaceholder}
                    aria-invalid={itemFieldError?.field === 'value'}
                    aria-describedby={itemFieldError?.field === 'value' ? 'detail-value-error' : undefined}
                    bind:value={itemValueDraft}
                    oninput={() => {
                      if (itemFieldError?.field === 'value') {
                        itemFieldError = undefined;
                      }
                    }}
                  />
                  {#if itemFieldError?.field === 'value'}
                    <span
                      class="text-xs font-medium text-red-600 dark:text-red-300"
                      id="detail-value-error"
                      role="alert">{itemFieldError.message}</span
                    >
                  {/if}
                </label>
                {#if itemKindDraft === 'work'}
                  <label class="grid gap-1 text-xs font-semibold text-gray-600 dark:text-gray-300">
                    Organisation
                    <input
                      class="min-h-11 rounded-lg border border-gray-300 bg-white px-3 text-sm font-normal text-immich-fg outline-none focus:border-primary dark:border-immich-dark-gray dark:bg-immich-dark-bg dark:text-immich-dark-fg"
                      bind:value={itemSecondaryDraft}
                    />
                  </label>
                {/if}
              {/if}
            </div>
            <div class="flex flex-wrap gap-2">
              <button
                class="inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-white disabled:opacity-50 dark:bg-immich-dark-primary dark:text-black"
                type="button"
                disabled={Boolean(busy)}
                onclick={() => void saveItem()}
              >
                <Icon icon={itemEditId ? mdiContentSaveOutline : mdiPlus} size="18" />
                {busy === 'item' ? 'Saving…' : itemEditId ? 'Update detail' : 'Add detail'}
              </button>
              {#if itemEditId}
                <button
                  class="min-h-11 rounded-lg px-4 text-sm font-semibold text-gray-600 hover:bg-gray-200 dark:text-gray-300 dark:hover:bg-white/10"
                  type="button"
                  disabled={Boolean(busy)}
                  onclick={resetItemDraft}>Cancel edit</button
                >
              {/if}
            </div>
          </div>

          {#if itemsDraft.length > 0}
            <div class="grid gap-2">
              <h3 class="text-sm font-semibold">Details in this draft</h3>
              {#each itemsDraft as item (item.itemId)}
                <div
                  class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-200 px-3 py-2 dark:border-immich-dark-gray"
                >
                  <div class="min-w-0">
                    <p class="text-xs font-medium text-gray-500 dark:text-gray-400">{item.label}</p>
                    <p class="text-sm font-semibold wrap-break-word">
                      {displayItemValue(item)}{item.secondaryValue ? ` · ${item.secondaryValue}` : ''}
                    </p>
                  </div>
                  <div class="flex gap-1">
                    <button
                      class="flex size-11 items-center justify-center rounded-lg text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/10"
                      type="button"
                      aria-label={`Edit ${item.label}`}
                      disabled={Boolean(busy)}
                      onclick={() => editItem(item)}><Icon icon={mdiPencilOutline} size="18" /></button
                    >
                    <button
                      class={`flex min-h-11 items-center justify-center rounded-lg px-3 text-sm font-semibold ${removeConfirmId === item.itemId ? 'bg-red-600 text-white' : 'text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950'}`}
                      type="button"
                      aria-label={removeConfirmId === item.itemId
                        ? `Confirm remove ${item.label}`
                        : `Remove ${item.label}`}
                      disabled={Boolean(busy)}
                      onclick={() => void removeItem(item.itemId)}
                    >
                      <Icon icon={mdiTrashCanOutline} size="18" />
                      {#if removeConfirmId === item.itemId}<span class="ml-1">Confirm</span>{/if}
                    </button>
                  </div>
                </div>
              {/each}
            </div>
          {/if}

          <label
            class="grid gap-2 text-sm font-semibold"
            title="Stored only in Cimmich. Visible whenever this Person is visible."
          >
            Notes
            <span class="sr-only" id="person-notes-boundary">
              Stored only in Cimmich. Visible whenever this Person is visible.
            </span>
            <textarea
              class="min-h-28 resize-y rounded-lg border border-gray-300 bg-transparent px-3 py-2 font-normal outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 dark:border-immich-dark-gray"
              maxlength="10000"
              aria-describedby="person-notes-boundary"
              bind:this={privateNotesEditorElement}
              bind:value={privateNotesDraft}
            ></textarea>
          </label>

          <div
            class="sticky bottom-0 z-10 -mx-5 flex flex-wrap justify-end gap-2 border-t border-gray-200 bg-white/95 px-5 py-4 backdrop-blur-sm sm:-mx-6 sm:px-6 dark:border-immich-dark-gray dark:bg-immich-dark-bg/95"
          >
            <button
              class="min-h-11 rounded-lg px-4 text-sm font-semibold text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/10"
              type="button"
              disabled={Boolean(busy)}
              onclick={cancelEditing}>Cancel</button
            >
            <button
              class="inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-white disabled:opacity-50 dark:bg-immich-dark-primary dark:text-black"
              type="button"
              disabled={Boolean(busy)}
              onclick={() => void saveProfile()}
            >
              <Icon icon={mdiContentSaveOutline} size="18" />
              {busy === 'profile' ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </div>
      {:else if editorView === 'display'}
        <div class="grid gap-5 p-5 sm:p-6">
          <div class="flex items-start gap-3 rounded-xl bg-gray-50 p-4 dark:bg-white/5">
            <Icon icon={mdiEyeSettingsOutline} size="22" class="mt-0.5 shrink-0" />
            <div>
              <h3 class="font-semibold">Shown in hero</h3>
              <p class="mt-1 text-sm text-gray-600 dark:text-gray-300">
                Choose what appears in {profile.person.displayName}'s hero. Use People defaults for library-wide
                changes.
              </p>
            </div>
          </div>
          <div class="grid gap-3 sm:grid-cols-2">
            {#each display.fields as field (field.fieldKey)}
              <fieldset class="rounded-xl border border-gray-200 p-4 dark:border-immich-dark-gray">
                <legend class="px-1 text-sm font-semibold">{fieldLabels[field.fieldKey]}</legend>
                <p class="mb-3 text-xs text-gray-500 dark:text-gray-400">
                  People default: {field.defaultVisible ? 'shown' : 'hidden'}
                </p>
                <div class="grid grid-cols-3 gap-1 rounded-xl bg-gray-100 p-1 dark:bg-white/5">
                  {#each [{ value: 'inherit' as const, label: 'Default' }, { value: 'show' as const, label: 'Show' }, { value: 'hide' as const, label: 'Hide' }] as option (option.value)}
                    <button
                      type="button"
                      class="min-h-11 rounded-lg px-2 text-xs font-semibold transition focus-visible:outline-2 focus-visible:outline-primary {personVisibilityDraft[
                        field.fieldKey
                      ] === option.value
                        ? 'bg-white text-primary shadow-sm dark:bg-gray-800 dark:text-immich-dark-primary'
                        : 'text-gray-600 hover:text-immich-fg dark:text-gray-300 dark:hover:text-white'}"
                      aria-pressed={personVisibilityDraft[field.fieldKey] === option.value}
                      onclick={() => (personVisibilityDraft[field.fieldKey] = option.value)}>{option.label}</button
                    >
                  {/each}
                </div>
              </fieldset>
            {/each}
          </div>
          <div
            class="sticky bottom-0 z-10 -mx-5 flex flex-wrap justify-end gap-2 border-t border-gray-200 bg-white/95 px-5 py-4 backdrop-blur-sm sm:-mx-6 sm:px-6 dark:border-immich-dark-gray dark:bg-immich-dark-bg/95"
          >
            <button
              class="min-h-11 rounded-lg px-4 text-sm font-semibold text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/10"
              type="button"
              disabled={Boolean(busy)}
              onclick={cancelEditing}>Cancel</button
            >
            <button
              class="inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-white disabled:opacity-50 dark:bg-immich-dark-primary dark:text-black"
              type="button"
              disabled={Boolean(busy)}
              onclick={() => void saveDisplay()}
            >
              <Icon icon={mdiContentSaveOutline} size="18" />
              {busy === 'display' ? 'Saving…' : 'Save display'}
            </button>
          </div>
        </div>
      {:else}
        <div class="grid gap-5 p-5 sm:p-6">
          <div
            class="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-950 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100"
          >
            <Icon icon={mdiEyeSettingsOutline} size="22" class="mt-0.5 shrink-0" />
            <div>
              <h3 class="font-semibold">People defaults</h3>
              <p class="mt-1 text-sm">These choices apply to every Person who uses Default.</p>
            </div>
          </div>
          <div class="grid gap-3 sm:grid-cols-2">
            {#each defaults.fields as field (field.fieldKey)}
              <label
                class="flex min-h-14 items-center justify-between gap-4 rounded-xl border border-gray-200 px-4 py-2 dark:border-immich-dark-gray"
              >
                <span class="text-sm font-semibold">{fieldLabels[field.fieldKey]}</span>
                <span class="inline-flex min-h-11 items-center gap-2 text-sm">
                  <input
                    class="size-5"
                    type="checkbox"
                    aria-label={`${fieldLabels[field.fieldKey]} shown by default`}
                    bind:checked={globalVisibilityDraft[field.fieldKey]}
                  />
                  {globalVisibilityDraft[field.fieldKey] ? 'Shown' : 'Hidden'}
                </span>
              </label>
            {/each}
          </div>
          <div
            class="sticky bottom-0 z-10 -mx-5 flex flex-wrap justify-end gap-2 border-t border-gray-200 bg-white/95 px-5 py-4 backdrop-blur-sm sm:-mx-6 sm:px-6 dark:border-immich-dark-gray dark:bg-immich-dark-bg/95"
          >
            <button
              class="min-h-11 rounded-lg px-4 text-sm font-semibold text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/10"
              type="button"
              disabled={Boolean(busy)}
              onclick={cancelEditing}>Cancel</button
            >
            <button
              class="inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-white disabled:opacity-50 dark:bg-immich-dark-primary dark:text-black"
              type="button"
              disabled={Boolean(busy)}
              onclick={() => void saveDefaults()}
            >
              <Icon icon={mdiContentSaveOutline} size="18" />
              {busy === 'defaults' ? 'Saving…' : 'Save People defaults'}
            </button>
          </div>
        </div>
      {/if}
    </div>
  {:else}
    <div class={['grid gap-4 md:grid-cols-2', railManaged ? 'person-dossier rounded-4xl p-4 sm:p-6' : undefined]}>
      {#if railManaged}
        <div class="dossier-masthead flex items-center justify-between gap-4 pb-3 md:col-span-2" aria-hidden="true">
          <span>Personal archive</span>
          <span>Profile dossier · {profile.person.displayName}</span>
        </div>
      {/if}
      {#if railManaged || (visibleDetailsSection('about') && (!compact || inlineTarget === 'about'))}
        <article
          class="dossier-card dossier-about rounded-2xl border border-gray-200 p-5 md:col-span-2 dark:border-immich-dark-gray"
          data-dossier-section="01"
        >
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div class="flex items-center gap-2">
              <span class="dossier-icon flex size-8 items-center justify-center rounded-xl" aria-hidden="true">
                <Icon icon={mdiNoteTextOutline} size="18" />
              </span>
              <h3 class="font-semibold">About</h3>
            </div>
            {#if inlineTarget !== 'about'}
              <button
                class={profile.profile.about
                  ? 'flex size-11 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary dark:text-gray-400 dark:hover:bg-white/10 dark:hover:text-immich-dark-primary'
                  : 'inline-flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm font-semibold text-primary hover:bg-primary/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary dark:text-immich-dark-primary'}
                type="button"
                aria-label={`${profile.profile.about ? 'Edit' : 'Add'} About`}
                title={`${profile.profile.about ? 'Edit' : 'Add'} About`}
                disabled={Boolean(inlineTarget)}
                onclick={() => void startInlineEditing('about')}
              >
                <Icon icon={profile.profile.about ? mdiPencilOutline : mdiPlus} size="18" />
                {#if !profile.profile.about}<span>Add</span>{/if}
              </button>
            {/if}
          </div>
          {#if inlineTarget === 'about'}
            <div class="mt-3 grid gap-4">
              <label class="grid gap-2 text-sm font-semibold">
                About
                <textarea
                  class="min-h-32 resize-y rounded-lg border border-gray-300 bg-transparent px-3 py-2 font-normal outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 dark:border-immich-dark-gray"
                  maxlength="4000"
                  bind:this={aboutEditorElement}
                  bind:value={aboutDraft}
                  placeholder="What would you like to remember about this person?"
                ></textarea>
              </label>
              {@render inlineActions('About')}
            </div>
          {:else if profile.profile.about}
            <p class="dossier-about-copy mt-4 max-w-4xl whitespace-pre-wrap">{profile.profile.about}</p>
          {:else}
            <p class="dossier-empty mt-3 text-sm text-gray-500 dark:text-gray-400">
              Add a short portrait of who this person is and what makes them memorable.
            </p>
          {/if}
        </article>
      {/if}

      {#if railManaged || visibleDetailsSection('at_a_glance')}
        <article
          class={`dossier-card dossier-facts rounded-2xl border border-gray-200 p-5 dark:border-immich-dark-gray ${inlineTarget === 'at_a_glance' ? 'md:col-span-2' : ''}`}
          data-dossier-section="02"
        >
          <div class="flex items-start justify-between gap-3">
            <h3 class="font-semibold">At a glance</h3>
            {#if inlineTarget !== 'at_a_glance'}
              <button
                class="flex size-11 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary dark:text-gray-400 dark:hover:bg-white/10 dark:hover:text-immich-dark-primary"
                type="button"
                aria-label="Edit At a glance"
                title="Edit At a glance"
                disabled={Boolean(inlineTarget)}
                onclick={() => void startInlineEditing('at_a_glance')}
                ><Icon icon={mdiPencilOutline} size="18" /></button
              >
            {/if}
          </div>
          {#if inlineTarget === 'at_a_glance'}
            <div class="mt-4 grid gap-4">
              <fieldset class="grid gap-2" bind:this={relationshipEditorElement}>
                <legend class="text-sm font-semibold">Relationship</legend>
                <div class="flex flex-wrap gap-2">
                  {#each profile.relationshipCatalog as category (category.categoryId)}
                    <button
                      class={`min-h-11 rounded-full border px-4 text-sm font-medium ${relationshipDraft.includes(category.categoryId) ? 'border-primary bg-primary/10 text-primary' : 'border-gray-300 hover:border-gray-500 dark:border-immich-dark-gray'}`}
                      type="button"
                      aria-pressed={relationshipDraft.includes(category.categoryId)}
                      onclick={() => toggleRelationship(category.categoryId)}>{category.name}</button
                    >
                  {/each}
                </div>
              </fieldset>
              <div class="grid gap-4 sm:grid-cols-2">
                <label class="grid gap-2 text-sm font-semibold">
                  Gender identity
                  <select
                    class="min-h-11 rounded-lg border border-gray-300 bg-transparent px-3 font-normal dark:border-immich-dark-gray dark:bg-immich-dark-bg"
                    bind:value={genderKindDraft}
                  >
                    <option value={null}>Not set</option>
                    <option value="woman">Woman</option>
                    <option value="man">Man</option>
                    <option value="non_binary">Non-binary</option>
                    <option value="self_described">Self-described</option>
                  </select>
                </label>
                <label class="grid gap-2 text-sm font-semibold">
                  Pronouns
                  <input
                    class="min-h-11 rounded-lg border border-gray-300 bg-transparent px-3 font-normal outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 dark:border-immich-dark-gray"
                    maxlength="80"
                    bind:value={pronounsDraft}
                  />
                </label>
              </div>
              {#if genderKindDraft === 'self_described'}
                <label class="grid gap-2 text-sm font-semibold sm:max-w-md">
                  Self-described gender identity
                  <input
                    class="min-h-11 rounded-lg border bg-transparent px-3 font-normal outline-none focus:ring-2 focus:ring-primary/20 {genderFieldError
                      ? 'border-red-500 focus:border-red-500'
                      : 'border-gray-300 focus:border-primary dark:border-immich-dark-gray'}"
                    maxlength="120"
                    required
                    aria-invalid={Boolean(genderFieldError)}
                    aria-describedby={genderFieldError ? 'inline-gender-identity-error' : undefined}
                    bind:value={genderLabelDraft}
                    oninput={() => (genderFieldError = '')}
                  />
                  {#if genderFieldError}
                    <span
                      class="text-xs font-medium text-red-600 dark:text-red-300"
                      id="inline-gender-identity-error"
                      role="alert">{genderFieldError}</span
                    >
                  {/if}
                </label>
              {/if}
              {@render inlineActions('At a glance')}
            </div>
          {:else}
            <dl class="dossier-glance-grid mt-4 text-sm">
              <div class="dossier-fact">
                <dt class="text-xs text-gray-500 dark:text-gray-400">Relationship</dt>
                <dd class="font-medium">{profile.relationships.map(({ name }) => name).join(', ') || 'Not set'}</dd>
              </div>
              <div class:fact-unset={!profile.profile.pronounsLabel} class="dossier-fact">
                <dt class="text-xs text-gray-500 dark:text-gray-400">Pronouns</dt>
                <dd class="font-medium">{profile.profile.pronounsLabel || 'Not added'}</dd>
              </div>
              <div class="dossier-fact dossier-gender-fact">
                <dt class="text-xs text-gray-500 dark:text-gray-400">Gender identity</dt>
                <dd class="font-medium">
                  <span
                    class="inline-flex size-8 items-center justify-center rounded-full bg-black/5 dark:bg-white/8"
                    aria-label={genderLabel || 'Not set'}
                    title={genderLabel || 'Not set'}
                  >
                    <Icon icon={genderIcon} size="20" />
                  </span>
                </dd>
              </div>
            </dl>
          {/if}
        </article>
      {/if}

      {#if railManaged || visibleDetailsSection('identity_summary')}
        <article
          class="dossier-card dossier-identity rounded-2xl border border-gray-200 p-5 dark:border-immich-dark-gray"
          data-dossier-section="03"
        >
          <div class="flex items-start justify-between gap-3">
            <div class="flex items-center gap-2">
              <span
                class="dossier-icon flex size-8 items-center justify-center rounded-xl bg-gray-100 text-gray-600 dark:bg-white/5 dark:text-gray-300"
                aria-hidden="true"
              >
                <Icon icon={mdiAccountDetailsOutline} size="18" />
              </span>
              <h3 class="font-semibold">Names & identity</h3>
            </div>
            <button
              class="flex size-11 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary dark:text-gray-400 dark:hover:bg-white/10 dark:hover:text-immich-dark-primary"
              type="button"
              aria-label="Edit Identity"
              title="Edit Identity"
              disabled={Boolean(inlineTarget)}
              onclick={onopenidentitysettings}><Icon icon={mdiPencilOutline} size="18" /></button
            >
          </div>
          <div class="dossier-nameplate mt-4">
            <span class="dossier-field-label">Primary name</span>
            <p class="dossier-primary-name">{profile.person.displayName}</p>
            <span class="dossier-field-label mt-4">Also known as</span>
            {#if aliases.length > 0}
              <div class="mt-2 flex flex-wrap gap-2">
                {#each aliases as alias (alias)}
                  <span class="dossier-alias">{alias}</span>
                {/each}
              </div>
            {:else}
              <p class="dossier-inline-empty mt-1">No other names recorded.</p>
            {/if}
          </div>
        </article>
      {/if}

      {#if railManaged || (visibleDetailsSection('important_dates') && (!compact || hasItems('important_date') || inlineTarget === 'important_date'))}
        {@render itemSectionCard('important_date')}
      {/if}
      {#if railManaged || (visibleDetailsSection('work') && (!compact || hasItems('work') || inlineTarget === 'work'))}
        {@render itemSectionCard('work')}
      {/if}

      {#if railManaged || (visibleDetailsSection('contact_details') && (!compact || contactItems.length > 0 || inlineTarget === 'contact'))}
        <article
          class={`dossier-card dossier-contact rounded-2xl border border-gray-200 p-5 dark:border-immich-dark-gray ${inlineTarget === 'contact' ? 'md:col-span-2' : ''}`}
          data-dossier-section="06"
        >
          <div class="flex items-start justify-between gap-3">
            <div class="flex items-center gap-2">
              <span
                class="dossier-icon flex size-8 items-center justify-center rounded-xl bg-gray-100 text-gray-600 dark:bg-white/5 dark:text-gray-300"
                aria-hidden="true"
              >
                <Icon icon={mdiPhoneOutline} size="18" />
              </span>
              <h3 class="font-semibold">Contact details</h3>
            </div>
            {#if inlineTarget !== 'contact'}
              <button
                class={contactItems.length > 0
                  ? 'flex size-11 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary dark:text-gray-400 dark:hover:bg-white/10 dark:hover:text-immich-dark-primary'
                  : 'inline-flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm font-semibold text-primary hover:bg-primary/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary dark:text-immich-dark-primary'}
                type="button"
                aria-label={`${contactItems.length > 0 ? 'Edit' : 'Add'} Contact details`}
                title={`${contactItems.length > 0 ? 'Edit' : 'Add'} Contact details`}
                disabled={Boolean(inlineTarget)}
                onclick={() => void startInlineEditing('contact')}
              >
                <Icon icon={contactItems.length > 0 ? mdiPencilOutline : mdiPlus} size="18" />
                {#if contactItems.length === 0}<span>Add</span>{/if}
              </button>
            {/if}
          </div>
          {#if inlineTarget === 'contact'}
            <div class="mt-4">
              {@render inlineItemEditor(contactKinds, 'Contact details')}
            </div>
          {:else if contactItems.length > 0}
            <ul class="dossier-contact-list mt-4 grid gap-2" aria-label="Contact details">
              {#each contactItems as item (item.itemId)}
                <li>
                  <a
                    class="dossier-contact-row"
                    href={itemHref(item)}
                    target={item.kind === 'web' ? '_blank' : undefined}
                    rel={item.kind === 'web' ? 'noreferrer' : undefined}
                  >
                    <span
                      class="dossier-icon flex size-9 shrink-0 items-center justify-center rounded-full"
                      aria-hidden="true"
                    >
                      <Icon icon={sectionIcons[item.kind]} size="18" />
                    </span>
                    <span class="min-w-0">
                      <span class="dossier-field-label block">
                        {item.kind === 'email' ? 'Email' : item.kind === 'phone' ? 'Phone' : 'Website'} · {item.label}
                      </span>
                      <span class="block truncate font-semibold">
                        {displayItemValue(item)}
                      </span>
                    </span>
                  </a>
                </li>
              {/each}
            </ul>
          {:else}
            <p class="dossier-empty mt-4 text-sm text-gray-500 dark:text-gray-400">
              Add an email, phone number, or website.
            </p>
          {/if}
        </article>
      {/if}

      {#if railManaged || (visibleDetailsSection('social') && (!compact || hasItems('social') || inlineTarget === 'social'))}
        {@render itemSectionCard('social')}
      {/if}
      {#if railManaged || (visibleDetailsSection('address') && (!compact || hasItems('address') || inlineTarget === 'address'))}
        {@render itemSectionCard('address')}
      {/if}

      {#if railManaged || (visibleDetailsSection('private_notes') && (!compact || profile.profile.privateNotes || inlineTarget === 'private_notes'))}
        <article
          class="dossier-card dossier-notes rounded-2xl border border-gray-200 p-5 dark:border-immich-dark-gray"
          data-dossier-section="09"
        >
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div class="flex items-center gap-2">
              <span class="dossier-icon flex size-8 items-center justify-center rounded-xl" aria-hidden="true">
                <Icon icon={mdiNoteTextOutline} size="18" />
              </span>
              <h3 class="font-semibold">Notes</h3>
            </div>
            {#if inlineTarget !== 'private_notes'}
              <button
                class={profile.profile.privateNotes
                  ? 'flex size-11 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary dark:text-gray-400 dark:hover:bg-white/10 dark:hover:text-immich-dark-primary'
                  : 'inline-flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm font-semibold text-primary hover:bg-primary/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary dark:text-immich-dark-primary'}
                type="button"
                aria-label={`${profile.profile.privateNotes ? 'Edit' : 'Add'} Notes`}
                title={`${profile.profile.privateNotes ? 'Edit' : 'Add'} Notes`}
                disabled={Boolean(inlineTarget)}
                onclick={() => void startInlineEditing('private_notes')}
              >
                <Icon icon={profile.profile.privateNotes ? mdiPencilOutline : mdiPlus} size="18" />
                {#if !profile.profile.privateNotes}<span>Add</span>{/if}
              </button>
            {/if}
          </div>
          {#if inlineTarget === 'private_notes'}
            <div class="mt-3 grid gap-4">
              <label
                class="grid gap-2 text-sm font-semibold"
                title="Stored only in Cimmich. Visible whenever this Person is visible."
              >
                Notes
                <span class="sr-only" id="inline-person-notes-boundary">
                  Stored only in Cimmich. Visible whenever this Person is visible.
                </span>
                <textarea
                  class="min-h-32 resize-y rounded-lg border border-gray-300 bg-transparent px-3 py-2 font-normal outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 dark:border-immich-dark-gray"
                  maxlength="10000"
                  aria-describedby="inline-person-notes-boundary"
                  bind:this={privateNotesEditorElement}
                  bind:value={privateNotesDraft}
                ></textarea>
              </label>
              {@render inlineActions('Notes')}
            </div>
          {:else if profile.profile.privateNotes}
            <p class="dossier-note-copy mt-4 whitespace-pre-wrap">{profile.profile.privateNotes}</p>
          {:else}
            <p class="dossier-empty mt-3 text-sm text-gray-500 dark:text-gray-400">
              Write down something worth remembering.
            </p>
          {/if}
        </article>
      {/if}
    </div>
  {/if}
</section>

<style>
  .person-dossier {
    --dossier-accent: #9b6a2f;
    --dossier-border: rgba(92, 68, 39, 0.2);
    --dossier-ink: #292217;
    --dossier-muted: #766b5b;
    color: var(--dossier-ink);
    border: 1px solid var(--dossier-border);
    background:
      radial-gradient(circle at 12% 0%, rgba(176, 121, 52, 0.18), transparent 30%),
      repeating-linear-gradient(0deg, rgba(96, 72, 42, 0.025) 0 1px, transparent 1px 31px),
      linear-gradient(145deg, #f7f2e8, #eee4d4 70%, #e8dcc9);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.8),
      0 24px 60px rgba(69, 48, 24, 0.12);
  }

  :global(.dark) .person-dossier {
    --dossier-border: rgba(224, 190, 137, 0.16);
    --dossier-ink: #f1e8d9;
    --dossier-muted: #afa28f;
    background:
      radial-gradient(circle at 12% 0%, rgba(184, 128, 60, 0.14), transparent 32%),
      repeating-linear-gradient(0deg, rgba(242, 225, 198, 0.018) 0 1px, transparent 1px 31px),
      linear-gradient(145deg, #171512, #100f0d 72%, #0c0b0a);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.04),
      0 24px 70px rgba(0, 0, 0, 0.35);
  }

  .dossier-masthead {
    border-bottom: 1px solid var(--dossier-border);
    color: var(--dossier-muted);
    font-size: 0.68rem;
    font-weight: 750;
    letter-spacing: 0.2em;
    text-transform: uppercase;
  }

  .dossier-card {
    --dossier-accent: #9b6a2f;
    position: relative;
    overflow: hidden;
    border-color: color-mix(in srgb, var(--dossier-accent) 24%, transparent);
    background:
      linear-gradient(115deg, color-mix(in srgb, var(--dossier-accent) 6%, transparent), transparent 42%),
      rgba(255, 253, 248, 0.78);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.72),
      0 10px 28px rgba(75, 53, 28, 0.075);
  }

  :global(.dark) .dossier-card {
    background:
      linear-gradient(115deg, color-mix(in srgb, var(--dossier-accent) 12%, transparent), transparent 42%),
      rgba(28, 26, 22, 0.78);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.045),
      0 12px 30px rgba(0, 0, 0, 0.2);
  }

  .dossier-card::before {
    position: absolute;
    inset: 0 0 auto;
    height: 3px;
    content: '';
    background: linear-gradient(90deg, var(--dossier-accent), transparent 70%);
  }

  .dossier-card::after {
    position: absolute;
    right: 0.8rem;
    bottom: -1.4rem;
    z-index: 0;
    content: attr(data-dossier-section);
    color: var(--dossier-accent);
    font-size: 5rem;
    font-weight: 800;
    line-height: 1;
    opacity: 0.055;
    pointer-events: none;
  }

  .dossier-card > * {
    position: relative;
    z-index: 1;
  }

  .dossier-card h3 {
    letter-spacing: 0.025em;
  }

  .dossier-card dt {
    color: var(--dossier-muted);
    font-size: 0.66rem;
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }

  .dossier-card dd {
    margin-top: 0.2rem;
    font-size: 0.96rem;
  }

  .dossier-field-label {
    color: var(--dossier-muted);
    font-size: 0.66rem;
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }

  .dossier-icon {
    color: var(--dossier-accent);
    background: color-mix(in srgb, var(--dossier-accent) 10%, transparent);
  }

  .dossier-empty {
    max-width: 34rem;
    border-top: 1px dashed color-mix(in srgb, var(--dossier-accent) 28%, transparent);
    padding-top: 0.85rem;
    color: var(--dossier-muted);
    line-height: 1.55;
  }

  .dossier-about {
    --dossier-accent: #9c6530;
    min-height: 7.5rem;
  }

  .dossier-about-copy {
    max-width: 68ch;
    font-family: Georgia, 'Times New Roman', serif;
    font-size: clamp(1rem, 1.2vw, 1.16rem);
    line-height: 1.7;
  }

  .dossier-facts {
    --dossier-accent: #737843;
  }

  .dossier-glance-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0.55rem;
  }

  .dossier-fact {
    min-width: 0;
    border: 1px solid color-mix(in srgb, var(--dossier-accent) 18%, transparent);
    border-radius: 0.8rem;
    padding: 0.7rem 0.75rem;
    background: color-mix(in srgb, var(--dossier-accent) 5%, transparent);
  }

  .dossier-fact.fact-unset dd,
  .dossier-inline-empty {
    color: var(--dossier-muted);
    font-weight: 500;
  }

  .dossier-gender-fact dd {
    margin-top: 0.35rem;
  }

  .dossier-identity {
    --dossier-accent: #4a6e88;
  }

  .dossier-nameplate {
    border-left: 2px solid color-mix(in srgb, var(--dossier-accent) 45%, transparent);
    padding-left: 1rem;
  }

  .dossier-primary-name {
    margin-top: 0.2rem;
    font-family: Georgia, 'Times New Roman', serif;
    font-size: 1.25rem;
    font-weight: 650;
    line-height: 1.25;
  }

  .dossier-alias {
    border: 1px solid color-mix(in srgb, var(--dossier-accent) 22%, transparent);
    border-radius: 999px;
    padding: 0.28rem 0.65rem;
    background: color-mix(in srgb, var(--dossier-accent) 7%, transparent);
    font-size: 0.82rem;
    font-weight: 650;
  }

  .dossier-card--important_date {
    --dossier-accent: #9a4f4d;
  }

  .dossier-timeline {
    position: relative;
    margin-left: 0.35rem;
    border-left: 1px solid color-mix(in srgb, var(--dossier-accent) 35%, transparent);
    padding-left: 1.15rem;
  }

  .dossier-timeline li {
    position: relative;
  }

  .dossier-timeline li::before {
    position: absolute;
    top: 0.25rem;
    left: -1.48rem;
    width: 0.62rem;
    height: 0.62rem;
    border: 2px solid color-mix(in srgb, var(--dossier-accent) 75%, white);
    border-radius: 999px;
    background: color-mix(in srgb, var(--dossier-accent) 75%, transparent);
    content: '';
  }

  .dossier-card--work {
    --dossier-accent: #9a6b32;
  }

  .dossier-work-entry {
    border-left: 2px solid color-mix(in srgb, var(--dossier-accent) 38%, transparent);
    padding: 0.15rem 0 0.25rem 0.9rem;
  }

  .dossier-contact {
    --dossier-accent: #3e7772;
  }

  .dossier-contact-row,
  .dossier-social-profile,
  .dossier-address {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 0.75rem;
    border: 1px solid color-mix(in srgb, var(--dossier-accent) 17%, transparent);
    border-radius: 0.85rem;
    padding: 0.65rem 0.75rem;
    background: color-mix(in srgb, var(--dossier-accent) 5%, transparent);
  }

  .dossier-contact-row,
  a.dossier-social-profile {
    transition:
      border-color 140ms ease,
      background 140ms ease,
      transform 140ms ease;
  }

  .dossier-contact-row:hover,
  a.dossier-social-profile:hover {
    border-color: color-mix(in srgb, var(--dossier-accent) 42%, transparent);
    background: color-mix(in srgb, var(--dossier-accent) 9%, transparent);
    transform: translateY(-1px);
  }

  .dossier-card--social {
    --dossier-accent: #765b88;
  }

  .dossier-card--address {
    --dossier-accent: #587454;
  }

  .dossier-address {
    align-items: flex-start;
  }

  .dossier-notes {
    --dossier-accent: #8e6d3e;
    min-height: 8rem;
    background:
      repeating-linear-gradient(
        0deg,
        transparent 0 30px,
        color-mix(in srgb, var(--dossier-accent) 10%, transparent) 30px 31px
      ),
      linear-gradient(115deg, color-mix(in srgb, var(--dossier-accent) 6%, transparent), transparent 42%),
      rgba(255, 253, 248, 0.78);
  }

  .dossier-note-copy {
    font-family: Georgia, 'Times New Roman', serif;
    font-size: 1rem;
    font-style: italic;
    line-height: 1.95;
  }

  :global(.dark) .dossier-notes {
    background:
      repeating-linear-gradient(
        0deg,
        transparent 0 30px,
        color-mix(in srgb, var(--dossier-accent) 12%, transparent) 30px 31px
      ),
      linear-gradient(115deg, color-mix(in srgb, var(--dossier-accent) 12%, transparent), transparent 42%),
      rgba(28, 26, 22, 0.78);
  }

  @media (max-width: 520px) {
    .dossier-glance-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
