-- slide.applescript
-- Slide operations script

-- Add new slide
on addSlide(docName, slidePosition, layoutType)
    tell application "Keynote"
        if docName is "" then
            set targetDoc to front document
        else
            set targetDoc to document docName
        end if
        
        if slidePosition is 0 then
            set newSlide to make new slide at end of slides of targetDoc
        else
            set newSlide to make new slide at slide slidePosition of targetDoc
        end if
        
        -- If no layout specified, default to Blank layout to avoid default text placeholders
        if layoutType is "" then
            set layoutType to "Blank"
        end if
        
        if layoutType is not "" then
            try
                set base slide of newSlide to master slide layoutType of targetDoc
            on error
                -- If layout not found, try using Blank layout
                try
                    set base slide of newSlide to master slide "Blank" of targetDoc
                    log "Layout " & layoutType & " not found, using Blank layout"
                on error
                    log "Neither " & layoutType & " nor Blank layout found, using default layout"
                end try
            end try
        end if
        
        return slide number of newSlide
    end tell
end addSlide

-- Delete slide
on deleteSlide(docName, slideNumber)
    tell application "Keynote"
        if docName is "" then
            set targetDoc to front document
        else
            set targetDoc to document docName
        end if
        
        delete slide slideNumber of targetDoc
    end tell
end deleteSlide

-- Duplicate slide
on duplicateSlide(docName, slideNumber, newPosition)
    tell application "Keynote"
        if docName is "" then
            set targetDoc to front document
        else
            set targetDoc to document docName
        end if
        
        set sourceSlide to slide slideNumber of targetDoc
        set newSlide to duplicate sourceSlide
        
        if newPosition is not 0 then
            move newSlide to slide newPosition of targetDoc
        end if
        
        return slide number of newSlide
    end tell
end duplicateSlide

-- Move slide
on moveSlide(docName, fromPosition, toPosition)
    tell application "Keynote"
        if docName is "" then
            set targetDoc to front document
        else
            set targetDoc to document docName
        end if
        
        set sourceSlide to slide fromPosition of targetDoc
        move sourceSlide to slide toPosition of targetDoc
    end tell
end moveSlide

-- Get slide count
on getSlideCount(docName)
    tell application "Keynote"
        if docName is "" then
            set targetDoc to front document
        else
            set targetDoc to document docName
        end if
        
        return count of slides of targetDoc
    end tell
end getSlideCount

-- Select slide
on selectSlide(docName, slideNumber)
    tell application "Keynote"
        if docName is "" then
            set targetDoc to front document
        else
            set targetDoc to document docName
        end if
        
        set current slide of targetDoc to slide slideNumber of targetDoc
    end tell
end selectSlide

-- Get current slide number
on getCurrentSlideNumber(docName)
    tell application "Keynote"
        if docName is "" then
            set targetDoc to front document
        else
            set targetDoc to document docName
        end if
        
        return slide number of current slide of targetDoc
    end tell
end getCurrentSlideNumber

-- Set slide layout
on setSlideLayout(docName, slideNumber, layoutType)
    tell application "Keynote"
        if docName is "" then
            set targetDoc to front document
        else
            set targetDoc to document docName
        end if
        
        try
            set master slide of slide slideNumber of targetDoc to master slide layoutType of targetDoc
            return true
        on error
            return false
        end try
    end tell
end setSlideLayout

-- Get available layouts list
on getAvailableLayouts(docName)
    tell application "Keynote"
        if docName is "" then
            set targetDoc to front document
        else
            set targetDoc to document docName
        end if
        
        set layoutList to {}
        repeat with masterSlide in master slides of targetDoc
            set end of layoutList to name of masterSlide
        end repeat
        return layoutList
    end tell
end getAvailableLayouts

-- Get slide info
on getSlideInfo(docName, slideNumber)
    tell application "Keynote"
        if docName is "" then
            set targetDoc to front document
        else
            set targetDoc to document docName
        end if
        
        set targetSlide to slide slideNumber of targetDoc
        set slideInfo to {}
        
        set end of slideInfo to slide number of targetSlide
        
        try
            set end of slideInfo to name of master slide of targetSlide
        on error
            set end of slideInfo to "Unknown Layout"
        end try
        
        try
            set end of slideInfo to count of text items of targetSlide
        on error
            set end of slideInfo to 0
        end try
        
        return slideInfo
    end tell
end getSlideInfo

-- Go to slide
on goToSlide(docName, slideNumber)
    tell application "Keynote"
        if docName is "" then
            set targetDoc to front document
        else
            set targetDoc to document docName
        end if
        
        set current slide of targetDoc to slide slideNumber of targetDoc
        show slide slideNumber of targetDoc
    end tell
end goToSlide

-- Get slide title
on getSlideTitle(docName, slideNumber)
    tell application "Keynote"
        if docName is "" then
            set targetDoc to front document
        else
            set targetDoc to document docName
        end if
        
        set targetSlide to slide slideNumber of targetDoc
        
        try
            -- Try to get the content of the title text box
            repeat with textItem in text items of targetSlide
                if object text of textItem contains "Title" then
                    return object text of textItem
                end if
            end repeat
            
            -- If no title found, return the first text item
            if (count of text items of targetSlide) > 0 then
                return object text of text item 1 of targetSlide
            else
                return ""
            end if
        on error
            return ""
        end try
    end tell
end getSlideTitle

-- Set slide title
on setSlideTitle(docName, slideNumber, titleText)
    tell application "Keynote"
        if docName is "" then
            set targetDoc to front document
        else
            set targetDoc to document docName
        end if
        
        set targetSlide to slide slideNumber of targetDoc
        
        try
            -- Try to find the title text box and set its content
            repeat with textItem in text items of targetSlide
                if object text of textItem contains "Title" then
                    set object text of textItem to titleText
                    return true
                end if
            end repeat
            
            -- If no title found, set the first text item
            if (count of text items of targetSlide) > 0 then
                set object text of text item 1 of targetSlide to titleText
                return true
            else
                return false
            end if
        on error
            return false
        end try
    end tell
end setSlideTitle 