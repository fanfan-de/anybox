-- presentation.applescript
-- Presentation management script

-- Create new presentation
on createNewPresentation(presentationName, themeName)
    tell application "Keynote"
        activate
        set newDoc to make new document
        
        if themeName is not "" then
            try
                set theme of newDoc to theme themeName
            on error
                -- If theme not found, use default theme
                log "Theme " & themeName & " not found, using default theme"
            end try
        end if
        
        -- Set the first slide layout to blank
        try
            set layoutType to "Blank"
            set base slide of slide 1 of newDoc to master slide layoutType of theme of newDoc
        on error
            log "Failed to set blank layout for first slide"
        end try
        
        -- If a name is specified, save to desktop
        if presentationName is not "" then
            set desktopPath to (path to desktop as string) & presentationName & ".key"
            save newDoc in file desktopPath
        end if
        
        return name of newDoc
    end tell
end createNewPresentation

-- Open presentation
on openPresentation(filePath)
    tell application "Keynote"
        set targetFile to POSIX file filePath
        open targetFile
        return name of front document
    end tell
end openPresentation

-- Save presentation
on savePresentation(docName)
    tell application "Keynote"
        if docName is "" then
            save front document
        else
            save document docName
        end if
    end tell
end savePresentation

-- Save presentation as
on saveAsPresentation(docName, filePath)
    tell application "Keynote"
        if docName is "" then
            set targetDoc to front document
        else
            set targetDoc to document docName
        end if
        
        set targetFile to POSIX file filePath
        save targetDoc in targetFile
    end tell
end saveAsPresentation

-- Close presentation
on closePresentation(docName, shouldSave)
    tell application "Keynote"
        if docName is "" then
            set targetDoc to front document
        else
            set targetDoc to document docName
        end if
        
        if shouldSave then
            save targetDoc
        end if
        
        close targetDoc
    end tell
end closePresentation

-- Get presentation info
on getPresentationInfo(docName)
    tell application "Keynote"
        if docName is "" then
            set targetDoc to front document
        else
            set targetDoc to document docName
        end if
        
        set docInfo to {}
        set end of docInfo to name of targetDoc
        set end of docInfo to count of slides of targetDoc
        
        try
            set end of docInfo to name of theme of targetDoc
        on error
            set end of docInfo to "Unknown Theme"
        end try
        
        return docInfo
    end tell
end getPresentationInfo

-- Set presentation theme
on setPresentationTheme(docName, themeName)
    tell application "Keynote"
        if docName is "" then
            set targetDoc to front document
        else
            set targetDoc to document docName
        end if
        
        try
            set theme of targetDoc to theme themeName
            return true
        on error
            return false
        end try
    end tell
end setPresentationTheme

-- Get available themes list
on getAvailableThemes()
    tell application "Keynote"
        set themeList to {}
        repeat with t in themes
            set end of themeList to name of t
        end repeat
        return themeList
    end tell
end getAvailableThemes

-- Duplicate presentation
on duplicatePresentation(docName, newName)
    tell application "Keynote"
        if docName is "" then
            set sourceDoc to front document
        else
            set sourceDoc to document docName
        end if
        
        set newDoc to duplicate sourceDoc
        if newName is not "" then
            set name of newDoc to newName
        end if
        
        return name of newDoc
    end tell
end duplicatePresentation

-- Get presentation properties
on getPresentationProperties(docName)
    tell application "Keynote"
        if docName is "" then
            set targetDoc to front document
        else
            set targetDoc to document docName
        end if
        
        set props to {}
        set end of props to name of targetDoc
        set end of props to count of slides of targetDoc
        
        try
            set end of props to name of theme of targetDoc
        on error
            set end of props to "Unknown"
        end try
        
        try
            set end of props to (height of targetDoc as string)
            set end of props to (width of targetDoc as string)
        on error
            set end of props to "Unknown"
            set end of props to "Unknown"
        end try
        
        return props
    end tell
end getPresentationProperties

-- Get presentation resolution
on getPresentationResolution(docName)
    tell application "Keynote"
        if docName is "" then
            set targetDoc to front document
        else
            set targetDoc to document docName
        end if
        
        set resolution to {}
        
        try
            -- Get document width and height
            set docWidth to width of targetDoc
            set docHeight to height of targetDoc
            
            set end of resolution to docWidth
            set end of resolution to docHeight
            
            return resolution
        on error
            -- If unable to get resolution, return standard 16:9 resolution
            set end of resolution to 1920
            set end of resolution to 1080
            return resolution
        end try
    end tell
end getPresentationResolution

-- Get slide size info
on getSlideSize(docName)
    tell application "Keynote"
        if docName is "" then
            set targetDoc to front document
        else
            set targetDoc to document docName
        end if
        
        set sizeInfo to {}
        
        try
            -- Get slide dimensions
            set slideWidth to width of targetDoc
            set slideHeight to height of targetDoc
            
            -- Calculate aspect ratio
            set aspectRatio to slideWidth / slideHeight
            
            set end of sizeInfo to slideWidth
            set end of sizeInfo to slideHeight
            set end of sizeInfo to aspectRatio
            
            -- Determine aspect ratio type
            if aspectRatio > 1.7 and aspectRatio < 1.8 then
                set end of sizeInfo to "16:9"
            else if aspectRatio > 1.3 and aspectRatio < 1.4 then
                set end of sizeInfo to "4:3"
            else
                set end of sizeInfo to "Custom"
            end if
            
            return sizeInfo
        on error
            -- Return default values
            set end of sizeInfo to 1920
            set end of sizeInfo to 1080
            set end of sizeInfo to 1.777
            set end of sizeInfo to "16:9"
            return sizeInfo
        end try
    end tell
end getSlideSize 