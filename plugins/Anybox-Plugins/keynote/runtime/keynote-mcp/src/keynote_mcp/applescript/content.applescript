-- content.applescript
-- Content management script

-- Add text box
on addTextBox(docName, slideNumber, textContent, xPos, yPos, textWidth, textHeight)
    tell application "Keynote"
        activate
        if docName is "" then
            set targetDoc to front document
        else
            set targetDoc to document docName
        end if
        
        tell targetDoc
            tell slide slideNumber
                -- Create text box
                set newTextBox to make new text item with properties {object text:textContent}
                
                -- Set position and size
                if xPos is not 0 or yPos is not 0 then
                    set position of newTextBox to {xPos, yPos}
                end if
                
                if textWidth is not 0 or textHeight is not 0 then
                    set size of newTextBox to {textWidth, textHeight}
                end if
            end tell
        end tell
        
        return true
    end tell
end addTextBox

-- Add title
on addTitle(docName, slideNumber, titleText, xPos, yPos, fontSize, fontName)
    tell application "Keynote"
        activate
        if docName is "" then
            set targetDoc to front document
        else
            set targetDoc to document docName
        end if
        
        tell targetDoc
            tell slide slideNumber
                -- Create title text box
                set newTitle to make new text item with properties {object text:titleText}
                
                -- Set position
                if xPos is not 0 or yPos is not 0 then
                    set position of newTitle to {xPos, yPos}
                end if
                
                -- Set font style
                tell newTitle
                    if fontSize is not 0 then
                        set size of object text to fontSize
                    else
                        set size of object text to 36  -- Default title size
                    end if
                    
                    if fontName is not "" then
                        set font of object text to fontName
                    end if
                    
                    -- Set to bold
                    set font style of object text to bold
                end tell
            end tell
        end tell
        
        return true
    end tell
end addTitle

-- Add subtitle
on addSubtitle(docName, slideNumber, subtitleText, xPos, yPos, fontSize, fontName)
    tell application "Keynote"
        activate
        if docName is "" then
            set targetDoc to front document
        else
            set targetDoc to document docName
        end if
        
        tell targetDoc
            tell slide slideNumber
                -- Create subtitle text box
                set newSubtitle to make new text item with properties {object text:subtitleText}
                
                -- Set position
                if xPos is not 0 or yPos is not 0 then
                    set position of newSubtitle to {xPos, yPos}
                end if
                
                -- Set font style
                tell newSubtitle
                    if fontSize is not 0 then
                        set size of object text to fontSize
                    else
                        set size of object text to 24  -- Default subtitle size
                    end if
                    
                    if fontName is not "" then
                        set font of object text to fontName
                    end if
                end tell
            end tell
        end tell
        
        return true
    end tell
end addSubtitle

-- Add bullet list
on addBulletList(docName, slideNumber, listItems, xPos, yPos, fontSize, fontName)
    tell application "Keynote"
        activate
        if docName is "" then
            set targetDoc to front document
        else
            set targetDoc to document docName
        end if
        
        tell targetDoc
            tell slide slideNumber
                -- Build list text
                set listText to ""
                repeat with i from 1 to count of listItems
                    set listText to listText & "• " & (item i of listItems)
                    if i < count of listItems then
                        set listText to listText & return
                    end if
                end repeat
                
                -- Create list text box
                set newList to make new text item with properties {object text:listText}

                -- Set position
                if xPos is not 0 or yPos is not 0 then
                    set position of newList to {xPos, yPos}
                end if

                -- Set font style
                tell newList
                    if fontSize is not 0 then
                        set size of object text to fontSize
                    else
                        set size of object text to 18  -- Default list size
                    end if

                    if fontName is not "" then
                        set font of object text to fontName
                    end if
                end tell
            end tell
        end tell

        return true
    end tell
end addBulletList

-- Add numbered list
on addNumberedList(docName, slideNumber, listItems, xPos, yPos, fontSize, fontName)
    tell application "Keynote"
        activate
        if docName is "" then
            set targetDoc to front document
        else
            set targetDoc to document docName
        end if
        
        tell targetDoc
            tell slide slideNumber
                -- Build numbered list text
                set listText to ""
                repeat with i from 1 to count of listItems
                    set listText to listText & (i as string) & ". " & (item i of listItems)
                    if i < count of listItems then
                        set listText to listText & return
                    end if
                end repeat
                
                -- Create numbered list text box
                set newList to make new text item with properties {object text:listText}

                -- Set position
                if xPos is not 0 or yPos is not 0 then
                    set position of newList to {xPos, yPos}
                end if

                -- Set font style
                tell newList
                    if fontSize is not 0 then
                        set size of object text to fontSize
                    else
                        set size of object text to 18  -- Default list size
                    end if
                    
                    if fontName is not "" then
                        set font of object text to fontName
                    end if
                end tell
            end tell
        end tell
        
        return true
    end tell
end addNumberedList

-- Add code block
on addCodeBlock(docName, slideNumber, codeText, xPos, yPos, fontSize, fontName)
    tell application "Keynote"
        activate
        if docName is "" then
            set targetDoc to front document
        else
            set targetDoc to document docName
        end if
        
        tell targetDoc
            tell slide slideNumber
                -- Create code block text box
                set newCodeBlock to make new text item with properties {object text:codeText}
                
                -- Set position
                if xPos is not 0 or yPos is not 0 then
                    set position of newCodeBlock to {xPos, yPos}
                end if
                
                -- Set font style (monospace)
                tell newCodeBlock
                    if fontSize is not 0 then
                        set size of object text to fontSize
                    else
                        set size of object text to 14  -- Default code font size
                    end if
                    
                    if fontName is not "" then
                        set font of object text to fontName
                    else
                        set font of object text to "Monaco"  -- Default monospace font
                    end if
                end tell
            end tell
        end tell
        
        return true
    end tell
end addCodeBlock

-- Add quote text
on addQuote(docName, slideNumber, quoteText, xPos, yPos, fontSize, fontName)
    tell application "Keynote"
        activate
        if docName is "" then
            set targetDoc to front document
        else
            set targetDoc to document docName
        end if
        
        tell targetDoc
            tell slide slideNumber
                -- Add quotation marks to the quote text
                set formattedQuote to """ & quoteText & """
                
                -- Create quote text box
                set newQuote to make new text item with properties {object text:formattedQuote}
                
                -- Set position
                if xPos is not 0 or yPos is not 0 then
                    set position of newQuote to {xPos, yPos}
                end if
                
                -- Set font style (italic)
                tell newQuote
                    if fontSize is not 0 then
                        set size of object text to fontSize
                    else
                        set size of object text to 20  -- Default quote font size
                    end if
                    
                    if fontName is not "" then
                        set font of object text to fontName
                    end if
                    
                    -- Set to italic
                    set font style of object text to italic
                end tell
            end tell
        end tell
        
        return true
    end tell
end addQuote

-- Edit text box content
on editTextBox(docName, slideNumber, textIndex, newContent)
    tell application "Keynote"
        if docName is "" then
            set targetDoc to front document
        else
            set targetDoc to document docName
        end if
        
        set targetSlide to slide slideNumber of targetDoc
        
        try
            set object text of text item textIndex of targetSlide to newContent
            return true
        on error
            return false
        end try
    end tell
end editTextBox

-- Add image
on addImage(docName, slideNumber, imagePath, xPos, yPos, imageWidth, imageHeight)
    tell application "Keynote"
        activate
        if docName is "" then
            set targetDoc to front document
        else
            set targetDoc to document docName
        end if
        
        tell targetDoc
            tell slide slideNumber
                -- Add image
                set imageFile to POSIX file imagePath
                set newImage to make new image with properties {file:imageFile}
                
                -- Set position and size
                if xPos is not 0 or yPos is not 0 then
                    set position of newImage to {xPos, yPos}
                end if
                
                if imageWidth is not 0 or imageHeight is not 0 then
                    set size of newImage to {imageWidth, imageHeight}
                end if
            end tell
        end tell
        
        return true
    end tell
end addImage

-- Add shape
on addShape(docName, slideNumber, shapeType, xPos, yPos, shapeWidth, shapeHeight)
    tell application "Keynote"
        if docName is "" then
            set targetDoc to front document
        else
            set targetDoc to document docName
        end if
        
        set targetSlide to slide slideNumber of targetDoc
        
        -- Create shape
        set newShape to make new shape at end of shapes of targetSlide
        
        -- Set shape type (simplified version)
        -- Note: Actual shape type setting may need adjustment for specific Keynote versions
        
        -- Set position and size
        if xPos is not 0 or yPos is not 0 then
            set position of newShape to {xPos, yPos}
        end if
        
        if shapeWidth is not 0 or shapeHeight is not 0 then
            set size of newShape to {shapeWidth, shapeHeight}
        end if
        
        return true
    end tell
end addShape

-- Add table
on addTable(docName, slideNumber, rowCount, columnCount, xPos, yPos)
    tell application "Keynote"
        if docName is "" then
            set targetDoc to front document
        else
            set targetDoc to document docName
        end if
        
        set targetSlide to slide slideNumber of targetDoc
        
        -- Create table
        set newTable to make new table at end of tables of targetSlide
        set row count of newTable to rowCount
        set column count of newTable to columnCount
        
        -- Set position
        if xPos is not 0 or yPos is not 0 then
            set position of newTable to {xPos, yPos}
        end if
        
        return true
    end tell
end addTable

-- Set table cell content
on setTableCell(docName, slideNumber, tableIndex, rowIndex, columnIndex, cellContent)
    tell application "Keynote"
        if docName is "" then
            set targetDoc to front document
        else
            set targetDoc to document docName
        end if
        
        set targetSlide to slide slideNumber of targetDoc
        
        try
            set targetTable to table tableIndex of targetSlide
            set value of cell columnIndex of row rowIndex of targetTable to cellContent
            return true
        on error
            return false
        end try
    end tell
end setTableCell

-- Set text style
on setTextStyle(docName, slideNumber, textIndex, fontSize, fontColor, fontName, isBold, isItalic)
    tell application "Keynote"
        if docName is "" then
            set targetDoc to front document
        else
            set targetDoc to document docName
        end if
        
        set targetSlide to slide slideNumber of targetDoc
        
        try
            set targetText to text item textIndex of targetSlide
            
            -- Set font size
            if fontSize is not 0 then
                set size of targetText to fontSize
            end if
            
            -- Set font name
            if fontName is not "" then
                set font of targetText to fontName
            end if
            
            -- Set bold and italic (simplified version)
            -- Note: Font style setting may need adjustment for specific Keynote versions
            
            return true
        on error
            return false
        end try
    end tell
end setTextStyle

-- Set object position
on positionObject(docName, slideNumber, objectType, objectIndex, xPos, yPos)
    tell application "Keynote"
        if docName is "" then
            set targetDoc to front document
        else
            set targetDoc to document docName
        end if
        
        set targetSlide to slide slideNumber of targetDoc
        
        try
            if objectType is "text" then
                set position of text item objectIndex of targetSlide to {xPos, yPos}
            else if objectType is "image" then
                set position of image objectIndex of targetSlide to {xPos, yPos}
            else if objectType is "shape" then
                set position of shape objectIndex of targetSlide to {xPos, yPos}
            else if objectType is "table" then
                set position of table objectIndex of targetSlide to {xPos, yPos}
            end if
            
            return true
        on error
            return false
        end try
    end tell
end positionObject

-- Resize object
on resizeObject(docName, slideNumber, objectType, objectIndex, newWidth, newHeight)
    tell application "Keynote"
        if docName is "" then
            set targetDoc to front document
        else
            set targetDoc to document docName
        end if
        
        set targetSlide to slide slideNumber of targetDoc
        
        try
            if objectType is "text" then
                set size of text item objectIndex of targetSlide to {newWidth, newHeight}
            else if objectType is "image" then
                set size of image objectIndex of targetSlide to {newWidth, newHeight}
            else if objectType is "shape" then
                set size of shape objectIndex of targetSlide to {newWidth, newHeight}
            else if objectType is "table" then
                set size of table objectIndex of targetSlide to {newWidth, newHeight}
            end if
            
            return true
        on error
            return false
        end try
    end tell
end resizeObject

-- Delete object
on deleteObject(docName, slideNumber, objectType, objectIndex)
    tell application "Keynote"
        if docName is "" then
            set targetDoc to front document
        else
            set targetDoc to document docName
        end if
        
        set targetSlide to slide slideNumber of targetDoc
        
        try
            if objectType is "text" then
                delete text item objectIndex of targetSlide
            else if objectType is "image" then
                delete image objectIndex of targetSlide
            else if objectType is "shape" then
                delete shape objectIndex of targetSlide
            else if objectType is "table" then
                delete table objectIndex of targetSlide
            end if
            
            return true
        on error
            return false
        end try
    end tell
end deleteObject

-- Get slide content statistics
on getSlideContentStats(docName, slideNumber)
    tell application "Keynote"
        if docName is "" then
            set targetDoc to front document
        else
            set targetDoc to document docName
        end if
        
        set targetSlide to slide slideNumber of targetDoc
        
        set stats to {}
        
        try
            set end of stats to count of text items of targetSlide
        on error
            set end of stats to 0
        end try
        
        try
            set end of stats to count of images of targetSlide
        on error
            set end of stats to 0
        end try
        
        try
            set end of stats to count of shapes of targetSlide
        on error
            set end of stats to 0
        end try
        
        try
            set end of stats to count of tables of targetSlide
        on error
            set end of stats to 0
        end try
        
        return stats
    end tell
end getSlideContentStats 