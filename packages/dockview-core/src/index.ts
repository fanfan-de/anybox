export {
    getPaneData,
    getPanelData,
    PaneTransfer,
    PanelTransfer,
} from './dnd/dataTransfer';

/**
 * Events, Emitters and Disposables are very common concepts that many codebases will contain, however we need
 * to export them for dockview framework packages to use.
 * To be a good citizen these are exported with a `Dockview` prefix to prevent accidental use by others.
 */
export { Emitter as DockviewEmitter, Event as DockviewEvent } from './events';
export type { IDisposable as DockviewIDisposable } from './lifecycle';
export {
    MutableDisposable as DockviewMutableDisposable,
    CompositeDisposable as DockviewCompositeDisposable,
    Disposable as DockviewDisposable,
} from './lifecycle';

export * from './panel/types';

export * from './splitview/splitview';
export type {
    SplitviewComponentOptions,
    PanelViewInitParameters,
    SplitviewOptions,
    SplitviewFrameworkOptions,
} from './splitview/options';
export {
    PROPERTY_KEYS_SPLITVIEW,
} from './splitview/options';

export * from './paneview/paneview';
export * from './gridview/gridview';
export type {
    GridviewComponentOptions,
    GridviewOptions,
    GridviewFrameworkOptions,
} from './gridview/options';
export {
    PROPERTY_KEYS_GRIDVIEW,
} from './gridview/options';
export * from './gridview/baseComponentGridview';

export type {
    PaneviewDidDropEvent,
} from './paneview/draggablePaneviewPanel';
export { DraggablePaneviewPanel } from './paneview/draggablePaneviewPanel';

export * from './dockview/components/panel/content';
export * from './dockview/components/tab/tab';
export {
    DockviewGroupPanelModel,
    DockviewDidDropEvent,
    DockviewWillDropEvent,
} from './dockview/dockviewGroupPanelModel';
export type {
    DockviewGroupChangeEvent,
    DockviewGroupActivePanelChangeEvent,
    DockviewGroupLocation,
} from './dockview/dockviewGroupPanelModel';
export {
    DockviewWillShowOverlayLocationEvent,
} from './dockview/events';
export type {
    DockviewTabGroupChangeEvent,
    DockviewTabGroupCollapsedChangeEvent,
    DockviewTabGroupPanelChangeEvent,
    DockviewGroupDropLocation,
} from './dockview/events';
export type {
    TabDragEvent,
    GroupDragEvent,
} from './dockview/components/titlebar/tabsContainer';
export * from './dockview/types';
export * from './dockview/dockviewGroupPanel';
export type {
    IGroupPanelBaseProps,
    IDockviewPanelHeaderProps,
    IDockviewPanelProps,
    IDockviewHeaderActionsProps,
    IGroupHeaderProps,
    IWatermarkPanelProps,
    DockviewReadyEvent,
    ITabGroupChipRenderer,
    IGroupDragGhostRenderer,
} from './dockview/framework';

export * from './dockview/options';
export * from './dockview/theme';
export * from './dockview/dockviewPanel';
export type {
    DockviewTabGroupColor,
    ITabGroup,
    SerializedTabGroup,
    TabGroupOptions,
} from './dockview/tabGroup';
export {
    DEFAULT_TAB_GROUP_COLORS,
    TabGroupColorPalette,
    applyTabGroupAccent,
    resolveTabGroupAccent,
} from './dockview/tabGroupAccent';
export type { DockviewTabGroupColorEntry } from './dockview/tabGroupAccent';
export { DefaultTab } from './dockview/components/tab/defaultTab';
export type {
    IPanelDeserializer,
} from './dockview/deserializer';
export { DefaultDockviewDeserialzier } from './dockview/deserializer';

export * from './dockview/dockviewComponent';
export type {
    EdgeGroupOptions,
    EdgeGroupPosition,
    SerializedEdgeGroups,
} from './dockview/dockviewShell';
export * from './gridview/gridviewComponent';
export * from './splitview/splitviewComponent';
export * from './paneview/paneviewComponent';
export type {
    PaneviewComponentOptions,
    PaneviewOptions,
    PaneviewFrameworkOptions,
    PaneviewDndOverlayEvent,
} from './paneview/options';
export {
    PROPERTY_KEYS_PANEVIEW,
    PaneviewUnhandledDragOverEvent,
} from './paneview/options';

export * from './gridview/gridviewPanel';
export type { ISplitviewPanel } from './splitview/splitviewPanel';
export { SplitviewPanel } from './splitview/splitviewPanel';
export * from './paneview/paneviewPanel';
export * from './dockview/types';
export type { Box, AnchorPosition, AnchoredBox } from './types';

export type { DockviewPanelRenderer } from './overlay/overlayRenderContainer';

export type {
    Position,
    MeasuredValue,
    DroptargetOverlayModel,
} from './dnd/droptarget';
export {
    positionToDirection,
    directionToPosition,
} from './dnd/droptarget';

export type {
    FocusEvent,
    PanelDimensionChangeEvent,
    VisibilityEvent,
    ActiveEvent,
    PanelApi,
} from './api/panelApi';
export type {
    SizeEvent,
    GridviewPanelApi,
    GridConstraintChangeEvent,
} from './api/gridviewPanelApi';
export type {
    TitleEvent,
    RendererChangedEvent,
    DockviewPanelApi,
    DockviewPanelMoveParams,
} from './api/dockviewPanelApi';
export type {
    PanelSizeEvent,
    PanelConstraintChangeEvent,
    SplitviewPanelApi,
} from './api/splitviewPanelApi';
export type { ExpansionEvent, PaneviewPanelApi } from './api/paneviewPanelApi';
export type {
    DockviewGroupPanelApi,
    DockviewGroupPanelLocationChangeEvent,
    DockviewGroupPanelCollapsedChangeEvent,
    DockviewGroupMoveParams,
} from './api/dockviewGroupPanelApi';
export {
    SplitviewApi,
    PaneviewApi,
    GridviewApi,
    DockviewApi,
} from './api/component.api';
export type {
    CommonApi,
    DockviewGetTabGroupsOptions,
} from './api/component.api';
export {
    createDockview,
    createGridview,
    createPaneview,
    createSplitview,
} from './api/entryPoints';
export {
    registerModules,
    getRegisteredModules,
    clearRegisteredModules,
    markDockviewPackageLoaded,
    isDockviewPackageLoaded,
    defineModule,
} from './dockview/modules';
export type {
    DockviewModule,
    ServiceCollection,
} from './dockview/modules';
export type {
    IAccessibilityHost,
    IAccessibilityService,
    IAdvancedDnDHost,
    IAdvancedDnDService,
    IContextMenuHost,
    IContextMenuService,
    IKeyboardDockingService,
    ITabGroupChipsHost,
    ITabGroupChipsService,
} from './dockview/moduleContracts';
export { resolveMessages } from './dockview/accessibilityMessages';
export { findRelativeZIndexParent } from './dom';
export type { IDragGhostSpec } from './dnd/backend';
export { LiveRegionModule } from './dockview/liveRegionService';
